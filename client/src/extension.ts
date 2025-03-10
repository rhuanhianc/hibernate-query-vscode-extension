import * as vscode from 'vscode';
import { SidebarProvider } from './sidebar/sidebarProvider';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { Logger } from './utils/logger';
import { TelemetryService } from './services/telemetryService';

let javaProcess: ChildProcess | null = null;
let sidebarProvider: SidebarProvider | null = null;
let logger: Logger;
let telemetryService: TelemetryService;
let configuredPort: number;
let actualPort: number;

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
                    isNative: determineIfNative(text.trim())
                };
            }

            // Remove comments to avoid false positives
            const codeWithoutComments = text
                .replace(/\/\/.*$/gm, '')
                .replace(/\/\*[\s\S]*?\*\//g, '');

            // Try multiple extraction methods in sequence for robustness

            // Method 1: Simple regex-based extraction
            const simpleExtraction = simpleExtractor(codeWithoutComments);
            if (simpleExtraction.success) {
                return {
                    query: simpleExtraction.query,
                    isNative: simpleExtraction.isNative
                };
            }

            // Method 2: Pattern-based extraction for specific cases
            const patternExtraction = patternExtractor(codeWithoutComments);
            if (patternExtraction.success) {
                return {
                    query: patternExtraction.query,
                    isNative: patternExtraction.isNative
                };
            }

            // Method 3: General-purpose extraction with state tracking
            const stateExtraction = stateBasedExtractor(codeWithoutComments);
            if (stateExtraction.success) {
                return {
                    query: stateExtraction.query,
                    isNative: stateExtraction.isNative
                };
            }

            // Fallback: If no extraction method worked, return the original text
            return {
                query: text.trim(),
                isNative: determineIfNative(text.trim())
            };
        };

        /**
         * Simple regex-based extractor for common query patterns
         */
        function simpleExtractor(text: string): {
            success: boolean,
            query: string,
            isNative: boolean
        } {
            // For native queries with simple structure
            if (text.includes(".createNativeQuery")) {
                const nativeQueryRegex = /\.createNativeQuery\s*\(\s*"([^"]+)"/;
                const match = text.match(nativeQueryRegex);

                if (match) {
                    return {
                        success: true,
                        query: match[1],
                        isNative: true
                    };
                }

                // Try with concatenated strings
                const concatRegex = /\.createNativeQuery\s*\(\s*((?:"[^"]*"(?:\s*\+\s*"[^"]*")*)|(?:'[^']*'(?:\s*\+\s*'[^']*')*))/;
                const concatMatch = text.match(concatRegex);

                if (concatMatch) {
                    // Process concatenated strings
                    const rawQueryString = concatMatch[1];
                    const extractedQuery = rawQueryString
                        .replace(/"\s*\+\s*"/g, '') // Remove concatenation
                        .replace(/^"|"$/g, '');     // Remove outer quotes

                    return {
                        success: true,
                        query: extractedQuery,
                        isNative: true
                    };
                }
            }

            // For JPQL queries
            if (text.includes(".createQuery")) {
                const jpqlQueryRegex = /\.createQuery\s*\(\s*"([^"]+)"/;
                const match = text.match(jpqlQueryRegex);

                if (match) {
                    return {
                        success: true,
                        query: match[1],
                        isNative: false
                    };
                }

                // Try with concatenated strings
                const concatRegex = /\.createQuery\s*\(\s*((?:"[^"]*"(?:\s*\+\s*"[^"]*")*)|(?:'[^']*'(?:\s*\+\s*'[^']*')*))/;
                const concatMatch = text.match(concatRegex);

                if (concatMatch) {
                    // Process concatenated strings
                    const rawQueryString = concatMatch[1];
                    const extractedQuery = rawQueryString
                        .replace(/"\s*\+\s*"/g, '') // Remove concatenation
                        .replace(/^"|"$/g, '');     // Remove outer quotes

                    return {
                        success: true,
                        query: extractedQuery,
                        isNative: false
                    };
                }
            }

            return {
                success: false,
                query: '',
                isNative: false
            };
        }

        /**
         * Pattern-based extractor for specific query patterns
         */
        function patternExtractor(text: string): {
            success: boolean,
            query: string,
            isNative: boolean
        } {
            // Handle the common case with date format patterns
            if ((text.includes("'YYYY'") || text.includes("'yyyy'")) &&
                (text.includes("to_char") || text.includes("TO_CHAR"))) {

                // Native SQL with to_char and date format
                let match;

                // More specific pattern for to_char with 'YYYY'
                const toCharPattern = /select\s+[^;]+to_char\([^,]+,\s*'[^']*(?:YYYY|yyyy)[^']*'\)[^;]*;/i;
                match = text.match(toCharPattern);

                if (match) {
                    return {
                        success: true,
                        query: match[0],
                        isNative: true
                    };
                }
            }

            // JPQL pattern with entity names in PascalCase
            const jpqlPattern = /FROM\s+[A-Z][a-zA-Z0-9]*\s+[a-z]\s+WHERE\s+[a-z]\.[a-zA-Z0-9.]+\s*=\s*:[a-zA-Z0-9_]+/i;
            const jpqlMatch = text.match(jpqlPattern);

            if (jpqlMatch) {
                return {
                    success: true,
                    query: jpqlMatch[0],
                    isNative: false
                };
            }

            return {
                success: false,
                query: '',
                isNative: false
            };
        }

        /**
         * State-based extractor that handles complex cases
         */
        function stateBasedExtractor(text: string): {
            success: boolean,
            query: string,
            isNative: boolean
        } {
            let isNative = false;
            let startIndex = -1;

            // Find the query creation call
            if (text.includes(".createNativeQuery")) {
                startIndex = text.indexOf(".createNativeQuery");
                isNative = true;
            } else if (text.includes(".createQuery")) {
                startIndex = text.indexOf(".createQuery");
                isNative = false;
            } else {
                return {
                    success: false,
                    query: '',
                    isNative: false
                };
            }

            // Find opening parenthesis
            const openParenIndex = text.indexOf("(", startIndex);
            if (openParenIndex === -1) {
                return {
                    success: false,
                    query: '',
                    isNative: isNative
                };
            }

            // Determine quote character used (single or double)
            let quoteChar = '';
            let firstQuoteIndex = -1;

            const singleQuoteIndex = text.indexOf("'", openParenIndex);
            const doubleQuoteIndex = text.indexOf('"', openParenIndex);

            if (singleQuoteIndex !== -1 && (doubleQuoteIndex === -1 || singleQuoteIndex < doubleQuoteIndex)) {
                quoteChar = "'";
                firstQuoteIndex = singleQuoteIndex;
            } else if (doubleQuoteIndex !== -1) {
                quoteChar = '"';
                firstQuoteIndex = doubleQuoteIndex;
            } else {
                return {
                    success: false,
                    query: '',
                    isNative: isNative
                };
            }

            // Extract query content with state tracking
            let queryContent = "";
            let i = firstQuoteIndex + 1;
            let insideQuery = true;

            while (i < text.length && insideQuery) {
                // Check for end quote that's not escaped
                if (text[i] === quoteChar && text[i - 1] !== '\\') {
                    // Check if this is followed by concatenation
                    const nextNonSpace = text.substring(i + 1).trim();
                    if (nextNonSpace.startsWith("+")) {
                        // Skip to the next quote
                        const nextQuoteIndex = text.indexOf(quoteChar, i + 1);
                        if (nextQuoteIndex !== -1) {
                            i = nextQuoteIndex + 1;
                            continue;
                        }
                    }
                    insideQuery = false;
                    break;
                }

                queryContent += text[i];
                i++;
            }

            if (queryContent) {
                // Post-process the query content
                // Fix date format patterns if this is a native query
                if (isNative) {
                    // Handle to_char with date format
                    queryContent = queryContent.replace(/to_char\s*\([^,]+,\s*'([^']+)(?!')/gi,
                        (match, format) => `to_char(${match.substring(8, match.indexOf(','))}, '${format}'`);

                    // Fix unclosed quotes in date patterns
                    if (queryContent.includes("'YYYY") && !queryContent.includes("'YYYY'")) {
                        queryContent = queryContent.replace(/'YYYY(?!\s*')/g, "'YYYY'");
                    }
                }

                return {
                    success: true,
                    query: queryContent,
                    isNative: isNative
                };
            }

            return {
                success: false,
                query: '',
                isNative: isNative
            };
        }

        /**
         * Helper function to determine if a query is native SQL or JPQL
         * Uses a scoring system based on characteristic patterns
         * 
         * @param query - The query text to analyze
         * @returns boolean - True if the query is likely native SQL, false if likely JPQL
         */
        function determineIfNative(query: string): boolean {
            // JPQL indicators
            const jpqlIndicators = [
                /JOIN\s+FETCH/i,                  // JOIN FETCH is specific to JPQL
                /\bMEMBER\s+OF\b/i,               // MEMBER OF is specific to JPQL
                /\bIS\s+EMPTY\b/i,                // IS EMPTY is specific to JPQL
                /\bNEW\s+[a-zA-Z0-9_.]+\s*\(/i,   // NEW constructor in JPQL
                /\bENTRY\s*\(/i,                  // ENTRY() is a JPQL function
                /\bFROM\s+[A-Z][a-zA-Z0-9]*\b/i,  // Entity names in PascalCase
                /\.[a-zA-Z][a-zA-Z0-9]*\b/i       // Property access with dot notation
            ];

            // Native SQL indicators
            const nativeSqlIndicators = [
                /CREATE\s+(?:TEMP\s+)?TABLE/i,    // CREATE TABLE is native SQL
                /ALTER\s+TABLE/i,                 // ALTER TABLE is native SQL
                /DROP\s+TABLE/i,                  // DROP TABLE is native SQL
                /WITH\s+[a-zA-Z0-9_]+\s+AS\s+\(/i, // CTEs are common in native SQL
                /\bROWNUM\b/i,                    // ROWNUM is Oracle SQL
                /\bDUAL\b/i,                      // DUAL is Oracle SQL
                /\b[a-z_]+\.[a-z_]+\.[a-z_]+\b/i, // Schema references
                /\b[a-z_]+\.[a-z_]+\b/i,          // Table references with schema 
                /to_char\s*\(/i,                  // Oracle to_char function
                /\b[a-z_]+_[a-z_]+\b/i            // Snake case table/column names
            ];

            let jpqlScore = 0;
            let nativeScore = 0;

            // Check JPQL indicators
            for (const pattern of jpqlIndicators) {
                if (pattern.test(query)) {
                    jpqlScore += 2;
                }
            }

            // Check native SQL indicators
            for (const pattern of nativeSqlIndicators) {
                if (pattern.test(query)) {
                    nativeScore += 2;
                }
            }

            // Additional checks
            // Check for underscores in names (SQL convention)
            if (query.includes('_')) {
                nativeScore += 1;
            }

            // Check for presence of JPA entities (with PascalCase)
            const entityJpaPattern = /\b[A-Z][a-zA-Z0-9]*\b(?!\s*\.)/g;
            const entityMatches = query.match(entityJpaPattern) || [];
            if (entityMatches.length > 0) {
                jpqlScore += 2;
            }

            return nativeScore >= jpqlScore;
        }

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