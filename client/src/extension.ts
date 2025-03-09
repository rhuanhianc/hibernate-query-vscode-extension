import * as vscode from 'vscode';
import { SidebarProvider } from './sidebar';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

let javaProcess: ChildProcess | null = null;
let sidebarProvider: SidebarProvider | null = null;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Activating Hibernate Query Tester Extension...');

    const config = vscode.workspace.getConfiguration('queryTester');
    const hibernateVersion = config.get<string>('hibernateVersion', '5'); // Default para 5
    const jarName = hibernateVersion.startsWith('6')
        ? 'query-tester-server-hibernate6-1.0-SNAPSHOT.jar'
        : 'query-tester-server-hibernate5-1.0-SNAPSHOT.jar';
    const serverPath = path.join(context.extensionPath, 'server', jarName);

    // Check if JAR file exists
    if (!fs.existsSync(serverPath)) {
        vscode.window.showErrorMessage(`Server file not found: ${serverPath}`);
        return;
    }

    // Show initialization notification
    const startingMessage = vscode.window.setStatusBarMessage('$(sync~spin) Starting Hibernate Query Tester Server...');

    // Create a custom output channel
    const outputChannel = vscode.window.createOutputChannel('Hibernate Query Tester Logs');

    // Start Java server
    try {
        javaProcess = spawn('java', ['-jar', serverPath]);

        // Wait for server to start
        const serverReady = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout exceeded when starting Java server.'));
            }, 30000); // 30 seconds timeout

            if (!javaProcess) {
                clearTimeout(timeout);
                reject(new Error('Failed to start Java process.'));
                return;
            }

            javaProcess.stdout?.on('data', (data: { toString: () => string | string[]; }) => {
                const output = data.toString();
                console.log(`Server: ${output}`);
                outputChannel.appendLine(`Server: ${output}`);

                if (output.includes('Server started')) {
                    clearTimeout(timeout);
                    resolve();
                }
            });

            javaProcess.stderr?.on('data', (data: { toString: () => string | undefined; }) => {
                console.error(`Server Error: ${data}`);
                outputChannel.appendLine(`Server Error: ${data}`);
            });

            javaProcess.on('error', (err: { message: any; }) => {
                clearTimeout(timeout);
                console.error(`Error spawning Java process: ${err.message}`);
                outputChannel.appendLine(`Error spawning Java process: ${err.message}`);
                reject(err);
            });

            javaProcess.on('exit', (code: number) => {
                if (code !== 0) {
                    clearTimeout(timeout);
                    reject(new Error(`Java server terminated with code ${code}`));
                }
            });
        });

        await serverReady;
        startingMessage.dispose();
        vscode.window.setStatusBarMessage('$(check) Hibernate Query Tester Server started', 3000);

        // Initialize sidebar provider
        sidebarProvider = new SidebarProvider(context);

        // Register webview provider
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                'hibernate-query-tester-sidebar',
                sidebarProvider
            )
        );
        // Improved function to extract queries
        const extractQuery = (text: string): { query: string, isNative: boolean } => {
            // Helper function to extract complete query content
            const extractCompleteQuery = (text: string): string => {
                // Remove comments to avoid false positives
                const textWithoutComments = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

                // Detect if the text is already a direct SQL/JPQL query
                if (textWithoutComments.trim().toUpperCase().match(/^(SELECT|UPDATE|DELETE|INSERT|WITH)/)) {
                    return textWithoutComments.trim();
                }

                // Patterns to identify the beginning of a query declaration
                const queryStartPatterns = [
                    /String\s+(?:sql\w*|jpql|hql|consulta\w*)\s*=\s*["']/,
                    /(?:entityManager|em|session)\.create(?:Native)?Query\s*\(\s*["']/,
                    /@(?:Named)?Query\s*\(\s*(?:nativeQuery\s*=\s*(?:true|false)\s*,\s*)?(?:value\s*=\s*)?["']/
                ];

                // Check if any start patterns are present
                let queryStartMatch = null;
                for (const pattern of queryStartPatterns) {
                    const match = textWithoutComments.match(pattern);
                    if (match) {
                        queryStartMatch = match;
                        break;
                    }
                }

                if (queryStartMatch) {
                    // Extract only the content between quotes
                    const stringPattern = /["']([^"']+)["']/g;
                    let stringMatch;
                    let fullQuery = '';

                    while ((stringMatch = stringPattern.exec(textWithoutComments)) !== null) {
                        if (stringMatch[1]) {
                            fullQuery += stringMatch[1];
                        }
                    }

                    return fullQuery.trim();
                }

                // If nothing is found, return the original text
                return textWithoutComments.trim();
            };

            // Extract the complete query text
            const queryText = extractCompleteQuery(text);

            // Determine if it's native SQL or JPQL
            const isNative = determineIfNative(queryText);

            return {
                query: queryText,
                isNative: isNative
            };
        };

        // Helper function to determine if a query is native SQL or JPQL
        function determineIfNative(query: string): boolean {
            // JPQL indicators (not native)
            const jpqlIndicators = [
                // JPQL syntax characteristics
                /JOIN\s+FETCH/i,                  // JOIN FETCH is specific to JPQL
                /\bIN\s*\(\s*:[a-zA-Z0-9_]+\s*\)/i,  // Parameters in IN clauses: IN (:param)
                /\bTYPE\s*\(/i,                   // TYPE() operator in JPQL
                /\bMEMBER\s+OF\b/i,               // MEMBER OF is specific to JPQL
                /\bIS\s+EMPTY\b/i,                // IS EMPTY is specific to JPQL
                /\bNEW\s+[a-zA-Z0-9_.]+\s*\(/i,   // NEW constructor in JPQL
                /\bINDEX\s*\(/i,                  // INDEX() is a JPQL function
                /\bTREAT\s*\(/i,                  // TREAT() is a JPQL function
                /\bENTRY\s*\(/i,                  // ENTRY() is a JPQL function
                /\bCASE\s+WHEN\s+[^=]*\s+IS\s+NULL\b/i  // CASE WHEN x IS NULL in JPQL
            ];

            // Characteristics suggesting native SQL
            const nativeSqlIndicators = [
                // SQL specific syntax
                /CREATE\s+(?:TEMP\s+)?TABLE/i,    // CREATE TABLE is native SQL
                /ALTER\s+TABLE/i,                 // ALTER TABLE is native SQL
                /DROP\s+TABLE/i,                  // DROP TABLE is native SQL
                /EXEC\s+/i,                       // EXEC is native SQL
                /EXECUTE\s+/i,                    // EXECUTE is native SQL
                /\bSP_/i,                         // Stored procedures starting with SP_
                /WITH\s+[a-zA-Z0-9_]+\s+AS\s+\(/i, // CTEs are more common in native SQL
                /INSERT\s+INTO\s+[a-zA-Z0-9_.]+\s*\(/i, // INSERT INTO with specific columns
                /MERGE\s+INTO/i,                  // MERGE INTO is native SQL
                /SELECT\s+TOP\s+/i,               // SELECT TOP is native SQL (SQL Server)
                /\bROWNUM\b/i,                    // ROWNUM is Oracle SQL
                /\bDUAL\b/i,                      // DUAL is Oracle SQL
                /\b[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+\b/i, // Full schemas: schema.table.column
                /\[\w+\]/                         // Identifiers in brackets [column] in SQL Server
            ];

            // Specific database schema indicators and naming conventions
            const schemaTablePatterns = [
                /\bel_[a-z_]+\.[a-z_]+\b/i,       // Schema pattern observed in examples
                /\bcop_[a-z_]+\b/i,               // Tables with cop_ prefix
                /\bgg_[a-z_]+\b/i,                // Tables with gg_ prefix
                /\bdic_[a-z_]+\b/i                // Tables with dic_ prefix
            ];

            // Check for presence of JPA entities (with PascalCase)
            const entityJpaPattern = /\b[A-Z][a-zA-Z0-9]*\b(?!\s*\.)/g;
            const entityMatches = query.match(entityJpaPattern) || [];
            const hasJpaEntities = entityMatches.length > 0 &&
                !query.includes('.') &&
                !query.includes('_');

            // Check for named parameters (strong JPQL characteristic)
            const namedParamPattern = /:[a-zA-Z0-9_]+/g;
            const hasNamedParams = (query.match(namedParamPattern) || []).length > 0;

            // Count indicators
            let jpqlScore = 0;
            let nativeScore = 0;

            // Check JPQL indicators
            for (const pattern of jpqlIndicators) {
                if (pattern.test(query)) {
                    jpqlScore += 2;  // Higher weight for specific JPQL characteristics
                }
            }

            // Check native SQL indicators
            for (const pattern of nativeSqlIndicators) {
                if (pattern.test(query)) {
                    nativeScore += 2;  // Higher weight for specific SQL characteristics
                }
            }

            // Check schema/table patterns (strong native SQL indicator)
            for (const pattern of schemaTablePatterns) {
                if (pattern.test(query)) {
                    nativeScore += 3;  // Even higher weight for schema/table patterns
                }
            }

            // Adjust score based on JPA entities and named parameters
            if (hasJpaEntities) {
                jpqlScore += 3;  // Strong JPQL indicator
            }

            if (hasNamedParams) {
                jpqlScore += 1;  // JPQL indicator (but can also occur in SQL)
            }

            // Check for underscores in names (native SQL indicator)
            if (query.includes('_')) {
                nativeScore += 1;
            }

            return nativeScore > jpqlScore;
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

        // Create a status bar item for quick access
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.text = "$(database) Hibernate Query Tester";
        statusBarItem.tooltip = "Open Hibernate Query Tester";
        statusBarItem.command = 'hibernate-query-tester-sidebar.focus';
        statusBarItem.show();

        context.subscriptions.push(statusBarItem);

        console.log('Hibernate Query Tester Extension successfully activated');

    } catch (err: any) {
        startingMessage.dispose();
        console.error(`Failed to start extension: ${err.message}`);
        outputChannel.appendLine(`Failed to start extension: ${err.message}`);
        vscode.window.showErrorMessage(`Hibernate Query Tester: Error starting - ${err.message}`);
    }
}

export function deactivate() {
    if (javaProcess) {
        javaProcess.kill();
        console.log('Hibernate Query Tester Server stopped');
    }
}
