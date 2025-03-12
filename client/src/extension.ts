import * as vscode from 'vscode';
import { SidebarProvider } from './sidebar/sidebarProvider';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { Logger } from './utils/logger';
import { TelemetryService } from './services/telemetryService';
import { QueryUtils } from './utils/queryUtils';

let javaProcess: ChildProcess | null = null;
let sidebarProvider: SidebarProvider | null = null;
let logger: Logger;
let telemetryService: TelemetryService;
let configuredPort: number;
let actualPort: number;
let queryUtils: QueryUtils;

/**
 * Checks if a port is available
 * @param port Port to be checked
 * @returns Promise that resolves to true if the port is available, false otherwise
 */
async function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();

        server.once('error', (err: NodeJS.ErrnoException) => {
            // If the port is in use, return false
            if (err.code === 'EADDRINUSE') {
                resolve(false);
            } else {
                // Other errors also mean we cannot use the port
                logger.error(`Error when checking port ${port}: ${err.message}`);
                resolve(false);
            }
        });

        server.once('listening', () => {
            // The port is available, close the server and return true
            server.close(() => {
                resolve(true);
            });
        });

        // Try to open the port
        server.listen(port, '127.0.0.1');
    });
}

/**
 * Finds an available port starting from an initial port
 * @param startPort Initial port to check
 * @param maxTries Maximum number of attempts
 * @returns Promise that resolves to the available port or rejects after several attempts
 */
async function findAvailablePort(startPort: number, maxTries: number = 50): Promise<number> {
    let currentPort = startPort;
    let tries = 0;

    while (tries < maxTries) {
        if (await isPortAvailable(currentPort)) {
            return currentPort;
        }

        logger.info(`Port ${currentPort} is in use, trying next port...`);
        currentPort++;
        tries++;
    }

    throw new Error(`Could not find an available port after ${maxTries} attempts.`);
}

export async function activate(context: vscode.ExtensionContext) {
    logger = Logger.getInstance();
    logger.info('Enabling Hibernate Query Tester Extension...');

    // Initialize telemetry
    telemetryService = TelemetryService.getInstance();
    telemetryService.setExtensionContext(context);

    queryUtils = new QueryUtils();

    context.subscriptions.push(
        vscode.commands.registerCommand('hibernate-query-tester.showLogs', () => {
            logger.show();
        })
    );

    const config = vscode.workspace.getConfiguration('queryTester');
    const hibernateVersion = config.get<string>('hibernateVersion', '5'); // Default to 5
    const jarName = hibernateVersion.startsWith('6')
        ? 'query-tester-server-hibernate6-1.0-SNAPSHOT.jar'
        : 'query-tester-server-hibernate5-1.0-SNAPSHOT.jar';
    const serverPath = path.join(context.extensionPath, 'server', jarName);

    // Check if JAR file exists
    if (!fs.existsSync(serverPath)) {
        const errorMsg = `Server file not found: ${serverPath}`;
        logger.error(errorMsg);
        vscode.window.showErrorMessage(errorMsg);
        telemetryService.sendConnectionErrorEvent();
        return;
    }

    // Show initialization notification
    const startingMessage = vscode.window.setStatusBarMessage('$(sync~spin) Starting Hibernate Query Tester Server...');

    // Get server port from configuration
    configuredPort = config.get<number>('serverPort') || 8089;

    // Start Java server
    try {
        // Find an available port starting from the configured port
        actualPort = await findAvailablePort(configuredPort);

        if (actualPort !== configuredPort) {
            logger.info(`Configured port ${configuredPort} is in use. Using alternative port ${actualPort}.`);
            vscode.window.showInformationMessage(`The configured port ${configuredPort} is in use. Using alternative port ${actualPort} for this session.`);
        }

        // Start the Java process with the available port
        javaProcess = spawn('java', ['-jar', serverPath, actualPort.toString()]);

        // Wait for server to start
        const serverReady = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout exceeded when starting Java server.'));
            }, 30000); // 30 seconds timeout

            if (!javaProcess) {
                clearTimeout(timeout);
                reject(new Error('Failed to start Java process.'));
                telemetryService.sendConnectionErrorEvent();
                return;
            }

            javaProcess.stdout?.on('data', (data: { toString: () => string | string[]; }) => {
                const output = data.toString();
                if (Array.isArray(output)) {
                    output.forEach(line => logger.parseServerLog(line));
                } else {
                    logger.parseServerLog(output);
                }

                if (output.includes('Server started')) {
                    clearTimeout(timeout);
                    telemetryService.sendConnectionSuccessEvent();
                    resolve();
                }
            });

            javaProcess.stderr?.on('data', (data: { toString: () => string | undefined; }) => {
                logger.error(`Server Error: ${data}`);
            });

            javaProcess.on('error', (err: { message: any; }) => {
                clearTimeout(timeout);
                logger.error(`Error spawning Java process: ${err.message}`);
                telemetryService.sendConnectionErrorEvent();
                reject(err);
            });

            javaProcess.on('exit', (code: number) => {
                if (code !== 0) {
                    clearTimeout(timeout);
                    telemetryService.sendConnectionErrorEvent();
                    reject(new Error(`Java server terminated with code ${code}`));
                }
            });
        });

        await serverReady;
        startingMessage.dispose();

        const portMessage = actualPort === configuredPort
            ? `$(check) Hibernate Query Tester Server started on port ${actualPort}`
            : `$(check) Hibernate Query Tester Server started on alternate port ${actualPort}`;

        vscode.window.setStatusBarMessage(portMessage, 5000);

        // Initialize sidebar provider
        sidebarProvider = new SidebarProvider(context, actualPort);

        // Register webview provider
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                'hibernate-query-tester-sidebar',
                sidebarProvider
            )
        );

        const extractQuery = (text: string): { query: string, isNative: boolean } => {
            // If text is already a direct SQL/JPQL query
            if (text.trim().toUpperCase().match(/^(SELECT|UPDATE|DELETE|INSERT|WITH|FROM)/)) {
                return {
                    query: text.trim(),
                    isNative: queryUtils.determineIfNative(text.trim())
                };
            }

            // Remove comments to avoid false positives
            const codeWithoutComments = text
                .replace(/\/\/.*$/gm, '')
                .replace(/\/\*[\s\S]*?\*\//g, '');

            return queryUtils.extractQueryFromContent(codeWithoutComments, false);
        };

        // Command to test a selected query
        context.subscriptions.push(
            vscode.commands.registerCommand('hibernate-query-tester.testQuery', () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('No active editor!');
                    return;
                }

                const selection = editor.selection;
                const text = editor.document.getText(selection);

                if (!text) {
                    vscode.window.showErrorMessage('Select a query to test!');
                    return;
                }
                const { query, isNative } = extractQuery(text);
                telemetryService.sendQueryExecutedEvent(isNative);
                sidebarProvider?.postMessage({
                    command: 'testQuery',
                    query,
                    isNative
                });

                // If the sidebar view isn't visible, show it
                vscode.commands.executeCommand('hibernate-query-tester-sidebar.focus');
            })
        );

        // Editor context command
        context.subscriptions.push(
            vscode.commands.registerTextEditorCommand('hibernate-query-tester.testQueryContext', (editor) => {
                const selection = editor.selection;
                const text = editor.document.getText(selection);

                if (!text) {
                    vscode.window.showErrorMessage('Select a query to test!');
                    return;
                }

                const { query, isNative } = extractQuery(text);
                sidebarProvider?.postMessage({
                    command: 'testQuery',
                    query,
                    isNative
                });

                // If the sidebar view isn't visible, show it
                vscode.commands.executeCommand('hibernate-query-tester-sidebar.focus');
            })
        );
        telemetryService.sendActivationEvent();

        // Create a status bar item for quick access
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.text = `$(database) Hibernate Query Tester [${actualPort}]`;
        statusBarItem.tooltip = `Open Hibernate Query Tester (Running on port ${actualPort})`;
        statusBarItem.command = 'hibernate-query-tester-sidebar.focus';
        statusBarItem.show();

        context.subscriptions.push(statusBarItem);

        logger.info(`Hibernate Query Tester Extension successfully activated on port ${actualPort}`);

    } catch (err: any) {
        startingMessage.dispose();
        logger.error(`Failed to start extension: ${err.message}`);
        telemetryService.sendConnectionErrorEvent();
        vscode.window.showErrorMessage(`Hibernate Query Tester: Error starting - ${err.message}`);
    }
}

export function deactivate() {
    if (javaProcess) {
        javaProcess.kill();
        logger.info(`Hibernate Query Tester Server stopped (was running on port ${actualPort})`);
    }
    if (telemetryService) {
        telemetryService.dispose();
    }
}