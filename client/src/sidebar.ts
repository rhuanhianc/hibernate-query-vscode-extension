import * as vscode from 'vscode';
import { QueryClient } from './queryClient';
import { Storage } from './storage';
import { log } from 'console';

export class SidebarProvider implements vscode.WebviewViewProvider {
    private _webview?: vscode.Webview;
    private queryClient: QueryClient;
    private storage: Storage;

    constructor(context: vscode.ExtensionContext) {
        this.queryClient = new QueryClient();
        this.storage = new Storage(context);
    }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._webview = webviewView.webview;

        // Configure webview
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..', 'media')
            ]
        };

        // Load webview content
        webviewView.webview.html = this._getHtmlForWebview();

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log(`Received message from webview: ${message.command}`);

            switch (message.command) {
                case 'executeQuery':
                    await this._executeQuery(message.query, message.params, message.saveParams, message.isNative);
                    break;
                case 'formatQuery':
                    this._formatQuery(message.query);
                    break;
                case 'loadHistory':
                    console.log('Loading query history...');
                    const queryHistory = this.storage.getQueryHistory();
                    console.log(`History loaded: ${queryHistory.length} items`);

                    this.postMessage({
                        command: 'history',
                        queryHistory: queryHistory
                    });
                    break;
                case 'loadParams':
                    this.postMessage({
                        command: 'params',
                        params: this.storage.getSavedParams()[message.query] || {}
                    });
                    break;
                case 'loadScannedQueries':
                    this.postMessage({
                        command: 'scannedQueries',
                        queries: this.storage.getScannedQueries()
                    });
                    break;
                case 'scanQueries':
                    this._scanQueries();
                    break;
                case 'saveConfiguration':
                    this._saveConfiguration(message.config);
                    break;
                case 'loadConfiguration':
                    this._loadConfiguration();
                    break;
                case 'clearQueryHistory':
                    this._clearQueryHistory();
                    break;
                case 'saveFavoriteQuery':
                    this._saveFavoriteQuery(message.name, message.query, message.params, message.isNative);
                    break;
                case 'loadFavorites':
                    this.postMessage({
                        command: 'favorites',
                        favorites: this.storage.getFavoriteQueries()
                    });
                    break;
                case 'removeFavoriteQuery':
                    this.storage.removeFavoriteQuery(message.name);
                    this.postMessage({
                        command: 'favorites',
                        favorites: this.storage.getFavoriteQueries()
                    });
                    break;
                case 'saveParamSet':
                    this._saveParamSet(message.name, message.params);
                    break;
                case 'loadParamSets':
                    this.postMessage({
                        command: 'paramSets',
                        paramSets: this.storage.getParamSets()
                    });
                    break;
                case 'removeParamSet':
                    this.storage.removeParamSet(message.name);
                    this.postMessage({
                        command: 'paramSets',
                        paramSets: this.storage.getParamSets()
                    });
                    break;
            }
        });

        // Load initial data
        try {
            console.log('Loading initial data...');

            // Load history
            const queryHistory = this.storage.getQueryHistory();
            console.log(`Loading history: ${queryHistory.length} items`);
            this.postMessage({ command: 'history', queryHistory: queryHistory });

            // Load scanned queries
            const scannedQueries = this.storage.getScannedQueries();
            console.log(`Loading scanned queries: ${scannedQueries.length} items`);
            this.postMessage({ command: 'scannedQueries', queries: scannedQueries });

            // Load favorites
            const favorites = this.storage.getFavoriteQueries();
            console.log(`Loading favorites: ${Object.keys(favorites).length} items`);
            this.postMessage({ command: 'favorites', favorites: favorites });

            // Load parameter sets
            const paramSets = this.storage.getParamSets();
            console.log(`Loading parameter sets: ${Object.keys(paramSets).length} items`);
            this.postMessage({ command: 'paramSets', paramSets: paramSets });
        } catch (error) {
            console.error('Error loading initial data:', error);
        }

        // Load initial configuration
        this._loadConfiguration();
    }

    public postMessage(message: any) {
        try {
            console.log(`Sending message to webview: ${message.command}`);
            if (message.command === 'history') {
                const historyLength = message.queryHistory ? message.queryHistory.length : 0;
                console.log(`Sending history: ${historyLength} items`);
            }
            this._webview?.postMessage(message);
        } catch (error) {
            console.error('Error sending message to webview:', error);
        }
    }

    private async _executeQuery(query: string, params: any, saveParams: boolean, isNative: boolean = false) {
        try {
            // Normalize query to allow for case insensitivity in keywords
            const normalizedQuery = this._normalizeQuery(query);

            const config = vscode.workspace.getConfiguration('queryTester');

            // Show loading indicator
            this.postMessage({ command: 'queryStatus', status: 'loading' });

            // Use the dedicated method from QueryClient
            const response = await this.queryClient.executeQuery(
                normalizedQuery,
                params,
                isNative,
                {
                    dbConfig: config.get('dbConfig'),
                    entityLibPath: config.get('entityLibPath'),
                    entityPackages: config.get('entityPackages'),
                    projectScan: config.get('projectScan'),
                    hibernateVersion: config.get('hibernateVersion')
                }
            );

            // Save successful query with params and native flag
            this.storage.saveQuery(query, params, isNative);
            if (saveParams) this.storage.saveParams(query, params);

            // Create a formatted response to display
            const results = response.results || [];
            const formattedResults = this._formatResults(results);

            this.postMessage({
                command: 'queryResult',
                status: response.status || 'SUCCESS',
                executionTime: response.executionTime || 0,
                message: response.message || 'Query executed successfully',
                rowCount: results.length,
                results: formattedResults,
                raw: results
            });
        } catch (e: any) {
            // Handle error
            this.postMessage({
                command: 'queryError',
                error: e.message,
                stack: e.stack
            });
        }
    }

    private _normalizeQuery(query: string): string {
        // Make the query parser more forgiving by normalizing keywords
        // This addresses the issue where "From" vs "FROM" causes errors
        const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
            'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'AND', 'OR'];

        let normalizedQuery = query;

        // Case-insensitive regex replacement for each keyword
        keywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'i');
            normalizedQuery = normalizedQuery.replace(regex, keyword);
        });

        return normalizedQuery;
    }

    private _formatResults(results: any[]): any {
        if (!results || results.length === 0) {
            return [];
        }

        // Get all unique keys from all results
        const allKeys = new Set<string>();
        results.forEach(item => {
            Object.keys(item).forEach(key => allKeys.add(key));
        });

        // Format each result row
        return {
            columns: Array.from(allKeys),
            rows: results.map(item => {
                const row: any = {};
                Array.from(allKeys).forEach(key => {
                    row[key] = item[key] !== undefined ? item[key] : null;
                });
                return row;
            })
        };
    }

    private _formatQuery(query: string) {
        try {
            // 1. Pre-processing: remove only external quotes, not within the query
            let cleanQuery = query.trim();

            // Check if the entire query is in quotes and remove them only in this case
            const firstChar = cleanQuery.charAt(0);
            const lastChar = cleanQuery.charAt(cleanQuery.length - 1);

            if ((firstChar === '"' || firstChar === "'") && firstChar === lastChar) {
                // Only remove quotes if the entire query is in quotes
                cleanQuery = cleanQuery.substring(1, cleanQuery.length - 1);
            }

            // Remove concatenation operators and quotes between them
            cleanQuery = cleanQuery.replace(/["']\s*\+\s*["']/g, ' ');

            // 2. List of SQL keywords for formatting
            const mainKeywords = [
                'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
                'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT', 'INSERT INTO', 'VALUES',
                'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
                'WITH', 'WINDOW'
            ];

            const joinKeywords = [
                'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'LEFT OUTER JOIN',
                'RIGHT OUTER JOIN', 'FULL OUTER JOIN', 'CROSS JOIN', 'NATURAL JOIN'
            ];

            const conditionalKeywords = [
                'AND', 'OR', 'XOR', 'NOT'
            ];

            // 3. Apply basic formatting - ensure we have adequate spaces
            let formattedQuery = cleanQuery;

            // Split the query into tokens to work with its structure
            // Convert everything to uppercase to facilitate recognition
            mainKeywords.forEach(keyword => {
                const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
                formattedQuery = formattedQuery.replace(regex, `\n${keyword.toUpperCase()}`);
            });

            joinKeywords.forEach(keyword => {
                const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
                formattedQuery = formattedQuery.replace(regex, `\n  ${keyword.toUpperCase()}`);
            });

            conditionalKeywords.forEach(keyword => {
                const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
                formattedQuery = formattedQuery.replace(regex, `\n    ${keyword.toUpperCase()}`);
            });

            // Handle ON clauses
            formattedQuery = formattedQuery.replace(/\bON\b/gi, '\n      ON');

            // Add line breaks after commas in selection lists
            formattedQuery = formattedQuery.replace(/,\s*/g, ',\n      ');

            // 4. Process the query line by line to apply indentation
            const lines = formattedQuery.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            const indentedLines: any[] = [];

            lines.forEach(line => {
                if (line.match(/^(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|UNION|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)/i)) {
                    // Main keyword - no indentation
                    indentedLines.push(line);
                } else if (line.match(/^(JOIN|INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN|CROSS JOIN)/i)) {
                    // JOIN - 2 space indentation
                    indentedLines.push('  ' + line);
                } else if (line.match(/^(AND|OR|XOR|NOT)/i)) {
                    // Conditionals - 4 space indentation
                    indentedLines.push('    ' + line);
                } else if (line.match(/^ON/i)) {
                    // ON clause - greater indentation
                    indentedLines.push('      ' + line);
                } else if (line.startsWith(',')) {
                    // List continuation - greater indentation
                    indentedLines.push('      ' + line);
                } else {
                    // Try to determine indentation based on context
                    const lastLine = indentedLines.length > 0 ? indentedLines[indentedLines.length - 1] : '';
                    const lastLineIndent = lastLine.length - lastLine.trimStart().length;

                    // By default, use the same indentation as the previous line
                    indentedLines.push(' '.repeat(lastLineIndent) + line);
                }
            });

            // 5. Normalize keywords to uppercase for better readability
            const allKeywords = [...mainKeywords, ...joinKeywords, ...conditionalKeywords,
                'AS', 'ON', 'USING', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
                'ASC', 'DESC', 'DISTINCT', 'ALL'];

            let finalQuery = indentedLines.join('\n');
            allKeywords.forEach(keyword => {
                const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
                finalQuery = finalQuery.replace(regex, keyword.toUpperCase());
            });

            // 6. Improve specific formatting of CASE clauses
            finalQuery = finalQuery.replace(/\bCASE\b/gi, '\n  CASE');
            finalQuery = finalQuery.replace(/\bWHEN\b/gi, '\n    WHEN');
            finalQuery = finalQuery.replace(/\bTHEN\b/gi, ' THEN');
            finalQuery = finalQuery.replace(/\bELSE\b/gi, '\n    ELSE');
            finalQuery = finalQuery.replace(/\bEND\b/gi, '\n  END');

            // Return the formatted query
            this.postMessage({ command: 'formattedQuery', query: finalQuery });
        } catch (e) {
            console.error('Error formatting query:', e);
            // If formatting fails, return the original query
            this.postMessage({ command: 'formattedQuery', query });
        }
    }

    // Enhanced regex for _scanQueries()
    private _scanQueries() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.postMessage({
                command: 'scanResult',
                success: false,
                message: 'No active editor to scan queries.'
            });
            return;
        }

        const text = editor.document.getText();
        const queries: string[] = [];

        // Function to extract a complete query, including concatenations
        const extractFullQuery = (text: string, startIndex: number, endMarker = ';') => {
            // Find the end of the statement
            let endIndex = text.indexOf(endMarker, startIndex);
            if (endIndex === -1) {
                // Try to find the end of the function if no semicolon is found
                endIndex = text.indexOf('}', startIndex);
                if (endIndex === -1) return null;
            }

            // Extract the block that potentially contains the query
            const block = text.substring(startIndex, endIndex);

            // Extract only the content between quotes
            const stringPattern = /["']([^"']+)["']/g;
            let match;
            let fullQuery = '';

            while ((match = stringPattern.exec(block)) !== null) {
                if (match[1]) {
                    fullQuery += match[1];
                }
            }

            return fullQuery.trim();
        };

        // 1. Capture String sql/jpql/hql declarations
        const sqlDeclarationPattern = /String\s+(sql\w*|jpql|hql|consulta\w*)\s*=\s*["']/g;
        let match;

        while ((match = sqlDeclarationPattern.exec(text)) !== null) {
            const query = extractFullQuery(text, match.index);
            if (query && !queries.includes(query)) {
                queries.push(query);
            }
        }

        // 2. Capture createQuery/createNativeQuery
        const createQueryPattern = /(?:entityManager|em|session)\.create(?:Native)?Query\s*\(\s*["']/g;
        while ((match = createQueryPattern.exec(text)) !== null) {
            const query = extractFullQuery(text, match.index, ')');
            if (query && !queries.includes(query)) {
                queries.push(query);
            }
        }

        // 3. Capture @Query and @NamedQuery
        const annotationQueryPattern = /@(?:Named)?Query\s*\(\s*(?:nativeQuery\s*=\s*(?:true|false)\s*,\s*)?(?:value\s*=\s*)?["']/g;
        while ((match = annotationQueryPattern.exec(text)) !== null) {
            const query = extractFullQuery(text, match.index, ')');
            if (query && !queries.includes(query)) {
                queries.push(query);
            }
        }

        // Clean results - remove empty lines and extra spaces
        const cleanedQueries = queries.map(query => {
            // Remove line breaks and extra spaces
            return query.replace(/\s+/g, ' ').trim();
        }).filter(query => query.length > 0);

        // Remove duplicates
        const uniqueQueries = [...new Set(cleanedQueries)];

        if (uniqueQueries.length > 0) {
            // Save the found queries
            this.storage.saveScannedQueries(uniqueQueries);

            this.postMessage({
                command: 'scanResult',
                success: true,
                queries: uniqueQueries,
                message: `Found ${uniqueQueries.length} queries in the document.`
            });
        } else {
            this.postMessage({
                command: 'scanResult',
                success: false,
                message: 'No queries found in the document.'
            });
        }
    }

    private _saveConfiguration(config: any) {
        try {
            // Update VS Code settings
            const configuration = vscode.workspace.getConfiguration('queryTester');

            // Update each property
            Object.keys(config).forEach(key => {
                configuration.update(key, config[key], vscode.ConfigurationTarget.Global);
            });

            // Notify the user that it may be necessary to restart the extension
            const serverPortUpdated = config.serverPort !== this.queryClient.getServerPort();
            const serverHostUpdated = config.serverHost !== this.queryClient.getServerHost();
            const hibernateVersionUpdated = config.hibernateVersion !== this.queryClient.getHibernateVersion();
            const message = serverPortUpdated || serverHostUpdated || hibernateVersionUpdated
                ? 'Configuration saved successfully. It is necessary to restart the extension to apply server changes.'
                : 'Configuration saved successfully.';

            this.postMessage({
                command: 'configurationSaved',
                success: true,
                message: message
            });


            // If the server port or host has changed or the Hibernate version has changed, prompt the user to restart
            if (config.serverHost !== this.queryClient.getServerHost ||
                config.serverPort !== this.queryClient.getServerPort
                || config.hibernateVersion !== this.queryClient.getHibernateVersion()) {

                vscode.window.showInformationMessage(
                    'Server settings have changed. Do you want to restart VS Code now?',
                    'Yes', 'No'
                ).then(selection => {
                    if (selection === 'Yes') {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                });
            }
        } catch (e: any) {
            this.postMessage({
                command: 'configurationSaved',
                success: false,
                message: `Error saving configuration: ${e.message}`
            });
        }
    }

    private _loadConfiguration() {
        try {
            const config = vscode.workspace.getConfiguration('queryTester');

            const configuration = {
                dbConfig: config.get('dbConfig'),
                serverHost: config.get('serverHost'),
                serverPort: config.get('serverPort'),
                logLevel: config.get('logLevel'),
                entityLibPath: config.get('entityLibPath'),
                entityPackages: config.get('entityPackages'),
                projectScan: config.get('projectScan'),
                hibernateVersion: config.get('hibernateVersion')
            };

            this.postMessage({
                command: 'configuration',
                config: configuration
            });
        } catch (e: any) {
            this.postMessage({
                command: 'configurationError',
                error: e.message
            });
        }
    }

    private _clearQueryHistory() {
        try {
            this.storage.clearQueries();
            this.postMessage({
                command: 'history',
                queryHistory: []
            });
            this.postMessage({
                command: 'notification',
                type: 'success',
                message: 'Query history cleared successfully.'
            });
        } catch (e: any) {
            this.postMessage({
                command: 'notification',
                type: 'error',
                message: `Error clearing history: ${e.message}`
            });
        }
    }

    private _saveFavoriteQuery(name: string, query: string, params: any, isNative: boolean) {
        try {
            this.storage.saveFavoriteQuery(name, query, params, isNative);
            this.postMessage({
                command: 'favorites',
                favorites: this.storage.getFavoriteQueries()
            });
            this.postMessage({
                command: 'notification',
                type: 'success',
                message: `Query '${name}' saved as favorite.`
            });
        } catch (e: any) {
            this.postMessage({
                command: 'notification',
                type: 'error',
                message: `Error saving favorite query: ${e.message}`
            });
        }
    }

    private _saveParamSet(name: string, params: any) {
        try {
            this.storage.saveParamSet(name, params);
            this.postMessage({
                command: 'paramSets',
                paramSets: this.storage.getParamSets()
            });
            this.postMessage({
                command: 'notification',
                type: 'success',
                message: `Parameter set '${name}' saved successfully.`
            });
        } catch (e: any) {
            this.postMessage({
                command: 'notification',
                type: 'error',
                message: `Error saving parameter set: ${e.message}`
            });
        }
    }

    private _getHtmlForWebview() {
        return `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Hibernate Query Tester</title>
            <style>
                :root {
                    --background-color: var(--vscode-editor-background);
                    --font-family: var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
                    --font-size: var(--vscode-font-size, 13px);
                    --container-padding: 20px;
                    --input-padding-vertical: 6px;
                    --input-padding-horizontal: 8px;
                    --input-margin-vertical: 4px;
                    --input-margin-horizontal: 0;
                    --button-padding-vertical: 6px;
                    --button-padding-horizontal: 12px;
                    --button-hover-background: var(--vscode-button-hoverBackground);
                    --primary-color: var(--vscode-button-background);
                    --panel-color: var(--vscode-panel-background);
                    --accent-color: var(--vscode-activityBarBadge-background);
                    --border-color: var(--vscode-panel-border);
                    --text-color: var(--vscode-editor-foreground);
                    --text-light-color: var(--vscode-descriptionForeground);
                    --error-color: var(--vscode-errorForeground);
                    --success-color: var(--vscode-testing-iconPassed);
                    --warning-color: var(--vscode-editorWarning-foreground);
                    --editor-background: var(--vscode-editor-background);
                    --tab-active-background: var(--vscode-tab-activeBackground, #1e1e1e);
                    --tab-background: var(--vscode-tab-inactiveBackground, #2d2d2d);
                }

                body {
                    padding: 0;
                    margin: 0;
                    width: 100%;
                    height: 100%;
                    background-color: var(--background-color);
                    color: var(--text-color);
                    font-family: var(--font-family);
                    font-size: var(--font-size);
                    line-height: 1.5;
                }

                .container {
                    padding: 10px;
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                }

                .tabs {
                    display: flex;
                    flex-wrap: wrap;
                    border-bottom: 1px solid var(--border-color);
                    margin-bottom: 10px;
                }

                .tab {
                    padding: 8px 16px;
                    cursor: pointer;
                    background-color: var(--tab-background);
                    border: none;
                    color: var(--text-color);
                    border-top-left-radius: 4px;
                    border-top-right-radius: 4px;
                    margin-right: 2px;
                    opacity: 0.8;
                }

                .tab.active {
                    background-color: var(--tab-active-background);
                    opacity: 1;
                    border-bottom: 2px solid var(--accent-color);
                }

                .tab-content {
                    display: none;
                    flex-direction: column;
                    flex-grow: 1;
                    overflow-y: auto;
                    height: calc(100% - 40px);
                }

                .tab-content.active {
                    display: flex;
                }

                .section {
                    margin-bottom: 12px;
                }

                h2, h3 {
                    margin-bottom: 8px;
                    font-weight: 500;
                }

                .query-editor {
                    position: relative;
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    background-color: var(--editor-background);
                    margin-bottom: 8px;
                }

                textarea, input, select {
                    width: 100%;
                    padding: var(--input-padding-vertical) var(--input-padding-horizontal);
                    border: 1px solid var(--border-color);
                    background-color: var(--editor-background);
                    color: var(--text-color);
                    box-sizing: border-box;
                    border-radius: 4px;
                    font-family: 'Fira Code', monospace, var(--font-family);
                }

                textarea:focus, input:focus, select:focus {
                    outline: 1px solid var(--accent-color);
                }

                textarea {
                    resize: vertical;
                    min-height: 100px;
                    white-space: pre;
                }

                .button-group {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-bottom: 8px;
                }

                button {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: var(--button-padding-vertical) var(--button-padding-horizontal);
                    background-color: var(--primary-color);
                    color: var(--text-color);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-family: var(--font-family);
                    font-size: var(--font-size);
                    transition: background-color 0.2s;
                }

                button:hover {
                    background-color: var(--button-hover-background);
                }

                button.secondary {
                    background-color: transparent;
                    border: 1px solid var(--border-color);
                }

                button.small {
                    padding: 4px 8px;
                    font-size: 11px;
                }

                button.icon-button {
                    padding: 4px;
                    background: none;
                }

                .toolbar {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 5px;
                }

                .params-container {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    max-height: 160px;
                    overflow-y: auto;
                    padding-right: 5px;
                }

                .param-item {
                    display: flex;
                    gap: 8px;
                }

                .param-item input {
                    flex: 1;
                }

                .query-results {
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    background-color: var(--editor-background);
                    flex-grow: 1;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .result-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 10px;
                    border-bottom: 1px solid var(--border-color);
                    background-color: var(--panel-color);
                }

                .result-body {
                    padding: 10px;
                    overflow: auto;
                    flex-grow: 1;
                }

                .result-info {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 15px;
                    margin-bottom: 10px;
                    font-size: 12px;
                }

                .result-info-item {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }

                .result-table {
                    width: 100%;
                    border-collapse: collapse;
                }

                .result-table th, .result-table td {
                    text-align: left;
                    padding: 6px 10px;
                    border: 1px solid var(--border-color);
                }

                .result-table th {
                    background-color: var(--panel-color);
                    position: sticky;
                    top: 0;
                    z-index: 1;
                }

                .result-actions {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                    margin-top: 5px;
                }

                .list-container {
                    overflow-y: auto;
                    max-height: 180px;
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                }

                .list-item {
                    padding: 6px 10px;
                    cursor: pointer;
                    border-bottom: 1px solid var(--border-color);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    transition: background-color 0.2s;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .list-item:hover {
                    background-color: var(--panel-color);
                }

                .list-item:last-child {
                    border-bottom: none;
                }

                .spinner {
                    border: 2px solid rgba(0, 0, 0, 0.1);
                    border-radius: 50%;
                    border-top: 2px solid var(--accent-color);
                    width: 16px;
                    height: 16px;
                    animation: spin 1s linear infinite;
                    display: inline-block;
                }

                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }

                .form-group {
                    margin-bottom: 10px;
                }

                .form-group label {
                    display: block;
                    margin-bottom: 4px;
                }

                .form-check {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-bottom: 4px;
                }

                .form-check input[type="checkbox"] {
                    width: auto;
                }

                .badge {
                    display: inline-block;
                    padding: 2px 6px;
                    border-radius: 10px;
                    font-size: 11px;
                    font-weight: bold;
                }

                .badge.success {
                    background-color: var(--success-color);
                    color: var(--background-color);
                }

                .badge.error {
                    background-color: var(--error-color);
                    color: var(--background-color);
                }

                .badge.warning {
                    background-color: var(--warning-color);
                    color: var (--background-color);
                }

                .notification {
                    padding: 8px 12px;
                    margin-bottom: 10px;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .notification.success {
                    background-color: rgba(35, 134, 54, 0.8);
                    border-left: 3px solid var(--success-color);
                }

                .notification.error {
                    background-color: rgba(176, 21, 21, 0.8);
                    border-left: 3px solid var(--error-color);
                }

                .notification.info {
                    background-color: rgba(14, 99, 156, 0.8);
                    border-left: 3px solid var(--accent-color);
                }

                .close-btn {
                    margin-left: auto;
                    cursor: pointer;
                    opacity: 0.6;
                }

                .close-btn:hover {
                    opacity: 1;
                }
                
                #notifications-container {
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    width: 300px;
                    z-index: 1000;
                }

                .code {
                    font-family: 'Fira Code', monospace, var(--font-family);
                    white-space: pre;
                    overflow-x: auto;
                }

                .query-lists {
                    margin-bottom: 8px;
                }

                .query-lists-tabs {
                    display: flex;
                    border-bottom: 1px solid var(--border-color);
                }
                .tooltip {
                    position: relative;
                    display: inline-block;
                }

                .tooltip .tooltip-text {
                    visibility: hidden;
                    width: 200px;
                    background-color: var(--panel-color);
                    color: var(--text-color);
                    text-align: center;
                    border-radius: 4px;
                    padding: 5px;
                    position: absolute;
                    z-index: 1;
                    bottom: 125%;
                    left: 50%;
                    transform: translateX(-50%);
                    opacity: 0;
                    transition: opacity 0.3s;
                    border: 1px solid var(--border-color);
                    font-size: 11px;

                }

                .tooltip:hover .tooltip-text {
                    visibility: visible;
                    opacity: 1;
                }

                .packages-list {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 5px;
                    margin-top: 5px;

                }

                .package-tag {
                    background-color: var(--panel-color);
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    padding: 2px 6px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 11px;

                }
                .query-lists-tab {
                    padding: 4px 8px;
                    font-size: 11px;
                    cursor: pointer;
                    background: transparent;
                    border: none;
                    margin-right: 4px;
                    opacity: 0.7;
                }

                .query-lists-tab.active {
                    border-bottom: 2px solid var(--accent-color);
                    opacity: 1;
                }

                .query-lists-content {
                    display: none;
                    max-height: 150px;
                    overflow-y: auto;
                    padding: 4px 0;
                }

                .query-lists-content.active {
                    display: block;
                }

                .scanned-query, .favorite-query {
                    padding: 4px 8px;
                    cursor: pointer;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    font-size: 11px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .scanned-query:hover, .favorite-query:hover {
                    background-color: var(--panel-color);
                }

                .split-inputs {
                    display: flex;
                    gap: 8px;
                }

                .split-inputs input, .split-inputs select {
                    flex: 1;
                }

                .modal {
                    display: none;
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.5);
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                }

                .modal.active {
                    display: flex;
                }

                .modal-content {
                    background-color: var(--panel-color);
                    padding: 16px;
                    border-radius: 4px;
                    width: 80%;
                    max-width: 400px;
                }

                .modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 16px;
                }

                .modal-body {
                    margin-bottom: 16px;
                }

                .modal-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                }

                /* Hide scrollbar when not needed */
                ::-webkit-scrollbar {
                    width: 8px;
                    height: 8px;
                }

                ::-webkit-scrollbar-track {
                    background: transparent;
                }

                ::-webkit-scrollbar-thumb {
                    background-color: rgba(150, 150, 150, 0.5);
                    border-radius: 4px;
                }

                ::-webkit-scrollbar-thumb:hover {
                    background-color: rgba(150, 150, 150, 0.8);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div id="notifications-container"></div>
                
                <div class="tabs">
                    <button class="tab active" data-tab="query">Query</button>
                    <button class="tab" data-tab="history">History</button>
                    <button class="tab" data-tab="favorites">Favorites</button>
                    <button class="tab" data-tab="param-sets">Parameter Sets</button>
                    <button class="tab" data-tab="config">Settings</button>
                </div>
                
                <div id="query-tab" class="tab-content active">
                    <!-- Query lists area (scanned and favorites) -->
                    <div class="query-lists">
                        <div class="query-lists-tabs">
                            <button class="query-lists-tab active" data-list="scanned">Queries</button>
                        </div>
                        <div id="scanned-queries-list" class="query-lists-content active">
                            <!-- Scanned queries will be added here -->
                            <div class="scanned-query">No scanned queries. Use the "Scan Queries" button.</div>
                        </div>
                        <div id="favorite-queries-list" class="query-lists-content">
                            <!-- Favorite queries will be added here -->
                            <div class="favorite-query">No favorite queries. Save queries by clicking "Save as Favorite".</div>
                        </div>
                    </div>
                    
                    <div class="section">
                        <div class="toolbar">
                            <h3>HQL/JPQL Query</h3>
                            <div>
                                <button id="format-btn" class="small secondary" title="Format Query">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21 10H3"></path>
                                        <path d="M21 6H3"></path>
                                        <path d="M21 14H3"></path>
                                        <path d="M21 18H3"></path>
                                    </svg>
                                    Format
                                </button>
                                <button id="clear-query-btn" class="small secondary" title="Clear Editor">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M3 6h18"></path>
                                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                    </svg>
                                    Clear
                                </button>
                            </div>
                        </div>
                        <div class="query-editor">
                            <textarea id="query-input" placeholder="Type your HQL/JPQL query here or select in the editor and click 'Test Selected Query'"></textarea>
                        </div>
                        
                        <div class="form-check">
                            <input type="checkbox" id="is-native-checkbox">
                            <label for="is-native-checkbox">Native Query (SQL)</label>
                        </div>
                    </div>

                    <div class="section">
                        <div class="toolbar">
                            <h3>Parameters</h3>
                            <div>
                                <button id="add-param-btn" class="small secondary">+ Add</button>
                                <button id="load-param-set-btn" class="small secondary">Load Set</button>
                                <button id="save-param-set-btn" class="small secondary">Save Set</button>
                            </div>
                        </div>
                        <div id="params-container" class="params-container">
                            <!-- Parameters will be added here -->
                        </div>
                        <div class="form-check">
                            <input type="checkbox" id="save-params-checkbox">
                            <label for="save-params-checkbox">Save parameters for this query</label>
                        </div>
                    </div>

                    <div class="button-group">
                        <button id="execute-btn">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                            Execute Query
                        </button>
                        <button id="scan-btn" class="secondary">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                            Scan Queries
                        </button>
                        <button id="save-favorite-btn" class="secondary">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                            </svg>
                            Save as Favorite
                        </button>
                    </div>

                    <div class="query-results">
                        <div class="result-header">
                            <span>Results</span>
                            <div>
                                <button id="copy-results-btn" class="small secondary" title="Copy Results">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                    </svg>
                                    Copy
                                </button>
                            </div>
                        </div>
                        <div id="result-body" class="result-body">
                            <div id="result-placeholder">
                                <p>Execute a query to see the results here.</p>
                            </div>
                            <div id="result-content" style="display: none;">
                                <div id="result-info" class="result-info">
                                    <!-- Info about results -->
                                </div>
                                <div id="result-table-container">
                                    <!-- Results table -->
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div id="history-tab" class="tab-content">
                    <div class="toolbar">
                        <h3>Query History</h3>
                        <button id="clear-history-btn" class="small secondary">Clear History</button>
                    </div>
                    <div id="history-list" class="list-container">
                        <!-- History will be added here -->
                        <div class="list-item">No queries in history</div>
                    </div>
                </div>
                
                <div id="favorites-tab" class="tab-content">
                    <div class="toolbar">
                        <h3>Favorite Queries</h3>
                    </div>
                    <div id="favorites-list" class="list-container">
                        <!-- Favorites will be added here -->
                        <div class="list-item">No favorite queries</div>
                    </div>
                </div>
                
                <div id="param-sets-tab" class="tab-content">
                    <div class="toolbar">
                        <h3>Saved Parameter Sets</h3>
                    </div>
                    <div id="param-sets-list" class="list-container">
                        <!-- Parameter sets will be added here -->
                        <div class="list-item">No saved parameter sets</div>
                    </div>
                </div>
                
    <div id="config-tab" class="tab-content">
                    <div class="section">
                        <h3>Database Settings</h3>
                        <div class="form-group">
                            <label for="db-url">Database URL</label>
                            <input type="text" id="db-url" placeholder="jdbc:postgresql://localhost:5432/database">
                        </div>
                        <div class="form-group">
                            <label for="db-username">User</label>
                            <input type="text" id="db-username">
                        </div>
                        <div class="form-group">
                            <label for="db-password">Password</label>
                            <input type="password" id="db-password">
                        </div>
                        <div class="form-group">
                            <label for="db-driver">JDBC Driver</label>
                            <input type="text" id="db-driver" placeholder="org.postgresql.Driver">
                        </div>
                    </div>

                    <div class="section">
                        <h3>Server Settings</h3>
                        <div class="form-group">
                            <label for="server-host">Server Host</label>
                            <input type="text" id="server-host" placeholder="127.0.0.1">
                        </div>
                        <div class="form-group">
                            <label for="server-port">Server Port</label>
                            <input type="number" id="server-port" placeholder="8089" min="1024" max="65535">
                        </div>
                         <div class="form-group">
                            <label for="log-level">Log Level</label>
                            <select id="log-level">
                                <option value="TRACE">TRACE</option>
                                <option value="DEBUG">DEBUG</option>
                                <option value="INFO">INFO</option>
                                <option value="WARN">WARN</option>
                                <option value="ERROR">ERROR</option>
                            </select>
                    </div>

                    <div class="section">
                        <h3>Hibernate Entities</h3>
                        <div class="form-group">
                            <label for="entity-lib-path">Path to JAR with Entities</label>
                            <input type="text" id="entity-lib-path">
                        </div>
                        <div class="form-group">
                            <label for="hibernate-version">Hibernate Version</label>
                            <select id="hibernate-version">
                                <option value="5.6.15">5.6.15</option>
                                <option value="6.4.4">6.4.4</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <div class="toolbar">
                                <label>Entity Packages</label>
                                <button id="add-package-btn" class="small secondary">+ Add</button>
                            </div>
                            <div id="entity-packages-container" class="packages-list">
                                <!-- Packages will be added here -->
                            </div>
                        </div>
                        
                        <div class="form-check">
                            <input type="checkbox" id="project-scan-checkbox">
                            <label for="project-scan-checkbox">Scan entities in the current project</label>
                        </div>
                    </div>

                    <button id="save-config-btn">Save Settings</button>
                </div>
                
                <!-- Modals -->
                <div id="save-favorite-modal" class="modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3>Save Query as Favorite</h3>
                            <span class="close-btn" id="close-favorite-modal">&times;</span>
                        </div>
                        <div class="modal-body">
                            <div class="form-group">
                                <label for="favorite-name">Favorite Query Name</label>
                                <input type="text" id="favorite-name" placeholder="Ex: Customer Query">
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button id="cancel-save-favorite" class="secondary">Cancel</button>
                            <button id="confirm-save-favorite">Save</button>
                        </div>
                    </div>
                </div>
                
                <div id="save-param-set-modal" class="modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3>Save Parameter Set</h3>
                            <span class="close-btn" id="close-param-set-modal">&times;</span>
                        </div>
                        <div class="modal-body">
                            <div class="form-group">
                                <label for="param-set-name">Set Name</label>
                                <input type="text" id="param-set-name" placeholder="Ex: Default Filters">
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button id="cancel-save-param-set" class="secondary">Cancel</button>
                            <button id="confirm-save-param-set">Save</button>
                        </div>
                    </div>
                </div>
                
                <div id="load-param-set-modal" class="modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3>Load Parameter Set</h3>
                            <span class="close-btn" id="close-load-param-set-modal">&times;</span>
                        </div>
                        <div class="modal-body">
                            <div id="param-sets-selector" class="list-container" style="max-height: 200px;">
                                <!-- List of parameter sets -->
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button id="cancel-load-param-set" class="secondary">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>

            <script>
                (function() {
                    const vscode = acquireVsCodeApi();
                    let activeTab = 'query';
                    let activeQueryList = 'scanned';
                    let currentResults = null;
                    let autoDetectedParams = [];
                    let savedParamSets = {};
                    let favoriteQueries = {};
                    let scannedQueries = [];
                    let queryHistory = [];
                    
                    // Tabs
                    document.querySelectorAll('.tab').forEach(tab => {
                        tab.addEventListener('click', () => {
                            const tabId = tab.dataset.tab;
                            setActiveTab(tabId);
                        });
                    });
                    
                    // Query Lists Tabs
                    document.querySelectorAll('.query-lists-tab').forEach(tab => {
                        tab.addEventListener('click', () => {
                            const listId = tab.dataset.list;
                            setActiveQueryList(listId);
                        });
                    });
                    
                    function setActiveTab(tabId) {
                        activeTab = tabId;
                        
                        // Update tab buttons
                        document.querySelectorAll('.tab').forEach(t => {
                            t.classList.toggle('active', t.dataset.tab === tabId);
                        });
                        
                        // Update tab content
                        document.querySelectorAll('.tab-content').forEach(content => {
                            content.classList.toggle('active', content.id === tabId + '-tab');
                        });
                    }
                    
                    function setActiveQueryList(listId) {
                        activeQueryList = listId;
                        
                        // Update list tabs
                        document.querySelectorAll('.query-lists-tab').forEach(t => {
                            t.classList.toggle('active', t.dataset.list === listId);
                        });
                        
                        // Update list content
                        document.querySelectorAll('.query-lists-content').forEach(content => {
                            content.classList.toggle('active', content.id === listId + '-queries-list');
                        });
                    }
                    
                    // Notifications
                    function showNotification(message, type = 'info', duration = 5000) {
                        const container = document.getElementById('notifications-container');
                        const notification = document.createElement('div');
                        notification.className = \`notification \${type}\`;
                        
                        const iconSvg = type === 'success' 
                            ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
                            : type === 'error'
                                ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
                                : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
                        
                        notification.innerHTML = \`
                            \${iconSvg}
                            <span>\${message}</span>
                            <span class="close-btn">&times;</span>
                        \`;
                        
                        container.appendChild(notification);
                        
                        // Auto-dismiss
                        const dismissTimeout = setTimeout(() => {
                            notification.remove();
                        }, duration);
                        
                        // Manual dismiss
                        notification.querySelector('.close-btn').addEventListener('click', () => {
                            clearTimeout(dismissTimeout);
                            notification.remove();
                        });
                    }
                    
                    // Modal functions
                    function openModal(modalId) {
                        document.getElementById(modalId).classList.add('active');
                    }
                    
                    function closeModal(modalId) {
                        document.getElementById(modalId).classList.remove('active');
                    }
                    
                    // Setup modal close buttons
                    document.querySelectorAll('.modal .close-btn, .modal button[id^="cancel-"]').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const modal = btn.closest('.modal');
                            modal.classList.remove('active');
                        });
                    });
                    
                    // Query execution
                    document.getElementById('execute-btn').addEventListener('click', () => {
                        executeQuery();
                    });
                    
                    function executeQuery() {
                        const query = document.getElementById('query-input').value.trim();
                        if (!query) {
                            showNotification('Please enter a valid query.', 'error');
                            return;
                        }
                        
                        const params = {};
                        document.querySelectorAll('.param-item').forEach(item => {
                            const key = item.querySelector('.param-name').value;
                            const value = item.querySelector('.param-value').value;
                            if (key) {
                                params[key] = value;
                            }
                        });
                        
                        const saveParams = document.getElementById('save-params-checkbox').checked;
                        const isNative = document.getElementById('is-native-checkbox').checked;
                        
                        // Show loading state
                        document.getElementById('result-placeholder').innerHTML = '<div style="display:flex;align-items:center;gap:10px;"><div class="spinner"></div> Executing query...</div>';
                        document.getElementById('result-placeholder').style.display = 'block';
                        document.getElementById('result-content').style.display = 'none';
                        
                        vscode.postMessage({
                            command: 'executeQuery',
                            query,
                            params,
                            saveParams,
                            isNative
                        });
                    }
                    
                    // Format query
                    document.getElementById('format-btn').addEventListener('click', () => {
                        const query = document.getElementById('query-input').value.trim();
                        if (query) {
                            vscode.postMessage({
                                command: 'formatQuery',
                                query
                            });
                        }
                    });
                    
                    // Clear query
                    document.getElementById('clear-query-btn').addEventListener('click', () => {
                        document.getElementById('query-input').value = '';
                        document.getElementById('is-native-checkbox').checked = false;
                        autoDetectedParams = [];
                        updateParamsUI();
                    });
                    
                    // Scan queries
                    document.getElementById('scan-btn').addEventListener('click', () => {
                        vscode.postMessage({ command: 'scanQueries' });
                    });
                    
                    // Save as favorite
                    document.getElementById('save-favorite-btn').addEventListener('click', () => {
                        const query = document.getElementById('query-input').value.trim();
                        if (!query) {
                            showNotification('Please enter a query to save as favorite.', 'error');
                            return;
                        }
                        
                        openModal('save-favorite-modal');
                    });
                    
                    document.getElementById('confirm-save-favorite').addEventListener('click', () => {
                        const name = document.getElementById('favorite-name').value.trim();
                        if (!name) {
                            showNotification('Please provide a name for the favorite query.', 'error');
                            return;
                        }
                        
                        const query = document.getElementById('query-input').value.trim();
                        const isNative = document.getElementById('is-native-checkbox').checked;
                        
                        // Get current params
                        const params = {};
                        document.querySelectorAll('.param-item').forEach(item => {
                            const key = item.querySelector('.param-name').value;
                            const value = item.querySelector('.param-value').value;
                            if (key) {
                                params[key] = value;
                            }
                        });
                        
                        vscode.postMessage({
                            command: 'saveFavoriteQuery',
                            name,
                            query,
                            params,
                            isNative
                        });
                        
                        closeModal('save-favorite-modal');
                        document.getElementById('favorite-name').value = '';
                    });
                    
                    // Param set handling
                    document.getElementById('save-param-set-btn').addEventListener('click', () => {
                        // Check if there are parameters to save
                        const paramItems = document.querySelectorAll('.param-item');
                        if (paramItems.length === 0) {
                            showNotification('No parameters to save.', 'error');
                            return;
                        }
                        
                        openModal('save-param-set-modal');
                    });
                    
                    document.getElementById('confirm-save-param-set').addEventListener('click', () => {
                        const name = document.getElementById('param-set-name').value.trim();
                        if (!name) {
                            showNotification('Please provide a name for the parameter set.', 'error');
                            return;
                        }
                        
                        // Get current params
                        const params = {};
                        document.querySelectorAll('.param-item').forEach(item => {
                            const key = item.querySelector('.param-name').value;
                            const value = item.querySelector('.param-value').value;
                            if (key) {
                                params[key] = value;
                            }
                        });
                        
                        vscode.postMessage({
                            command: 'saveParamSet',
                            name,
                            params
                        });
                        
                        closeModal('save-param-set-modal');
                        document.getElementById('param-set-name').value = '';
                    });
                    
                    document.getElementById('load-param-set-btn').addEventListener('click', () => {
                        updateParamSetsSelector();
                        openModal('load-param-set-modal');
                    });
                    
                    function updateParamSetsSelector() {
                        const container = document.getElementById('param-sets-selector');
                        container.innerHTML = '';
                        
                        if (Object.keys(savedParamSets).length === 0) {
                            container.innerHTML = '<div class="list-item">No saved parameter sets</div>';
                            return;
                        }
                        
                        Object.entries(savedParamSets).forEach(([name, params]) => {
                            const item = document.createElement('div');
                            item.className = 'list-item';
                            item.textContent = name;
                            
                            item.addEventListener('click', () => {
                                loadParamSet(name, params);
                                closeModal('load-param-set-modal');
                            });
                            
                            container.appendChild(item);
                        });
                    }
                    
                    function loadParamSet(name, params) {
                        // Clear existing params
                        document.getElementById('params-container').innerHTML = '';
                        
                        // Add params from the set
                        Object.entries(params).forEach(([key, value]) => {
                            addParamField(key, value);
                        });
                        
                        
                    }
                    
                    // Copy results
                    document.getElementById('copy-results-btn').addEventListener('click', () => {
                        if (currentResults) {
                            const jsonStr = JSON.stringify(currentResults, null, 2);
                            navigator.clipboard.writeText(jsonStr)
                                .then(() => showNotification('Results copied to clipboard!', 'success'))
                                .catch(err => showNotification('Error copying results: ' + err, 'error'));
                        } else {
                            showNotification('No results to copy.', 'info');
                        }
                    });
                    
                    // Parameters
                    document.getElementById('add-param-btn').addEventListener('click', () => {
                        addParamField('', '');
                    });
                    
                    function addParamField(name, value) {
                        const container = document.getElementById('params-container');
                        const paramItem = document.createElement('div');
                        paramItem.className = 'param-item';
                        
                        paramItem.innerHTML = \`
                            <input type="text" class="param-name" placeholder="Name" value="\${name}">
                            <input type="text" class="param-value" placeholder="Value" value="\${value}">
                            <button class="small secondary remove-param-btn">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        \`;
                        
                        container.appendChild(paramItem);
                        
                        paramItem.querySelector('.remove-param-btn').addEventListener('click', () => {
                            paramItem.remove();
                        });
                    }
                    
                    // Detect parameters from query
                    function detectQueryParams(query) {
                        if (!query) return [];
                        
                        // Detect both named parameters (:name) and positional parameters (?1)
                        const paramRegex = /(?::([a-zA-Z][a-zA-Z0-9]*)|\\?([0-9]+))/g;
                        const params = [];
                        let match;
                        
                        while ((match = paramRegex.exec(query)) !== null) {
                            // match[1] for named params, match[2] for positional params
                            const paramName = match[1] || match[2];
                            if (!params.includes(paramName)) {
                                params.push(paramName);
                            }
                        }
                        
                        return params;
                    }
                    
                    function updateParamsUI() {
                        const container = document.getElementById('params-container');
                        container.innerHTML = '';
                        
                        // Add fields for detected parameters
                        autoDetectedParams.forEach(param => {
                            addParamField(param, '');
                        });
                    }
                    
                    // Query input change handler to detect parameters
                    document.getElementById('query-input').addEventListener('input', (e) => {
                        const query = e.target.value;
                        autoDetectedParams = detectQueryParams(query);
                        updateParamsUI();
                    });
                    
                    // History
                    document.getElementById('clear-history-btn').addEventListener('click', () => {
                        vscode.postMessage({ command: 'clearQueryHistory' });
                    });
                    
                    function updateHistoryUI(history) {
                        const historyList = document.getElementById('history-list');
                        historyList.innerHTML = '';
                        
                        console.log('Updating history UI - type:', typeof history, 'size:', history ? history.length : 0);
                        
                        if (!history || history.length === 0) {
                            historyList.innerHTML = '<div class="list-item">No queries in history</div>';
                            return;
                        }
                        
                        history.forEach(item => {
                            // Check item format (can be string or object)
                            const isStringItem = typeof item === 'string';
                            const query = isStringItem ? item : item.query;
                            
                            if (!query) {
                                console.warn('Invalid item in history:', item);
                                return; // Skip invalid item
                            }
                            
                            const listItem = document.createElement('div');
                            listItem.className = 'list-item';
                            
                            // Create main content with query and timestamp
                            const contentDiv = document.createElement('div');
                            contentDiv.style.width = '100%';
                            
                            const queryText = document.createElement('div');
                            queryText.textContent = query.length > 70 ? query.substring(0, 70) + '...' : query;
                            queryText.title = query;
                            
                            // Format timestamp if available
                            if (!isStringItem && item.timestamp) {
                                const date = new Date(item.timestamp);
                                const formattedDate = \`\${date.toLocaleDateString()} \${date.toLocaleTimeString()}\`;
                                
                                const timestampDiv = document.createElement('div');
                                timestampDiv.textContent = formattedDate;
                                timestampDiv.style.fontSize = '10px';
                                timestampDiv.style.opacity = '0.7';
                                contentDiv.appendChild(timestampDiv);
                            }
                            
                            // Add native badge if applicable
                            if (!isStringItem && item.isNative) {
                                const badge = document.createElement('span');
                                badge.className = 'badge warning';
                                badge.textContent = 'SQL';
                                badge.style.marginLeft = '5px';
                                queryText.appendChild(badge);
                            }
                            
                            contentDiv.appendChild(queryText);
                            listItem.appendChild(contentDiv);
                            
                            // Click handler to load query and params
                            listItem.addEventListener('click', () => {
                                document.getElementById('query-input').value = query;
                                document.getElementById('is-native-checkbox').checked = 
                                    !isStringItem && item.isNative ? true : false;
                                setActiveTab('query');
                                
                                // Load params
                                document.getElementById('params-container').innerHTML = '';
                                if (!isStringItem && item.params && Object.keys(item.params).length > 0) {
                                    Object.entries(item.params).forEach(([key, value]) => {
                                        addParamField(key, value);
                                    });
                                } else {
                                    // Update params UI based on query
                                    autoDetectedParams = detectQueryParams(query);
                                    updateParamsUI();
                                }
                            });
                            
                            historyList.appendChild(listItem);
                        });
                    }
                    
                    // Update scanned queries list
                    function updateScannedQueriesUI(queries) {
                        const container = document.getElementById('scanned-queries-list');
                        container.innerHTML = '';
                        
                        if (!queries || queries.length === 0) {
                            container.innerHTML = '<div class="scanned-query">No scanned queries. Use the "Scan Queries" button.</div>';
                            return;
                        }
                        
                        queries.forEach(query => {
                            const item = document.createElement('div');
                            item.className = 'scanned-query';
                            item.textContent = query.length > 50 ? query.substring(0, 50) + '...' : query;
                            item.title = query;
                            
                            item.addEventListener('click', () => {
                                document.getElementById('query-input').value = query;
                                
                                // Auto detect params for this query
                                autoDetectedParams = detectQueryParams(query);
                                updateParamsUI();
                            });
                            
                            container.appendChild(item);
                        });
                    }
                    
                    // Update favorites list
                    function updateFavoritesUI(favorites) {
                        // Update tab favorites list
                        const favoritesList = document.getElementById('favorites-list');
                        favoritesList.innerHTML = '';
                        
                        // Update dropdown list
                        const favoriteQueriesList = document.getElementById('favorite-queries-list');
                        favoriteQueriesList.innerHTML = '';
                        
                        if (!favorites || Object.keys(favorites).length === 0) {
                            favoritesList.innerHTML = '<div class="list-item">No favorite queries</div>';
                            favoriteQueriesList.innerHTML = '<div class="favorite-query">No favorite queries. Save queries by clicking "Save as Favorite".</div>';
                            return;
                        }
                        
                        // Update both UI components with favorites
                        Object.entries(favorites).forEach(([name, data]) => {
                            // For the favorites tab
                            const listItem = document.createElement('div');
                            listItem.className = 'list-item';
                            
                            const contentDiv = document.createElement('div');
                            contentDiv.style.width = '100%';
                            
                            const nameDiv = document.createElement('div');
                            nameDiv.textContent = name;
                            nameDiv.style.fontWeight = 'bold';
                            
                            const queryDiv = document.createElement('div');
                            queryDiv.textContent = data.query.length > 70 ? data.query.substring(0, 70) + '...' : data.query;
                            queryDiv.style.fontSize = '11px';
                            queryDiv.title = data.query;
                            
                            // Add native badge if applicable
                            if (data.isNative) {
                                const badge = document.createElement('span');
                                badge.className = 'badge warning';
                                badge.textContent = 'SQL';
                                badge.style.marginLeft = '5px';
                                nameDiv.appendChild(badge);
                            }
                            
                            contentDiv.appendChild(nameDiv);
                            contentDiv.appendChild(queryDiv);
                            
                            // Remove button
                            const removeBtn = document.createElement('button');
                            removeBtn.className = 'small secondary';
                            removeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                            removeBtn.title = 'Remove from favorites';
                            
                            removeBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                vscode.postMessage({
                                    command: 'removeFavoriteQuery',
                                    name
                                });
                            });
                            
                            listItem.appendChild(contentDiv);
                            listItem.appendChild(removeBtn);
                            
                            // Click handler to load query and params
                            listItem.addEventListener('click', () => {
                                document.getElementById('query-input').value = data.query;
                                document.getElementById('is-native-checkbox').checked = data.isNative || false;
                                setActiveTab('query');
                                
                                // Load params
                                document.getElementById('params-container').innerHTML = '';
                                if (data.params) {
                                    Object.entries(data.params).forEach(([key, value]) => {
                                        addParamField(key, value);
                                    });
                                } else {
                                    // Auto detect params
                                    autoDetectedParams = detectQueryParams(data.query);
                                    updateParamsUI();
                                }
                            });
                            
                            favoritesList.appendChild(listItem);
                            
                            // For the dropdown in query tab
                            const dropdownItem = document.createElement('div');
                            dropdownItem.className = 'favorite-query';
                            dropdownItem.textContent = name;
                            dropdownItem.title = data.query;
                            
                            // Add native badge if applicable
                            if (data.isNative) {
                                const badge = document.createElement('span');
                                badge.className = 'badge warning';
                                badge.textContent = 'SQL';
                                badge.style.marginLeft = '5px';
                                badge.style.fontSize = '9px';
                                dropdownItem.appendChild(badge);
                            }
                            
                            dropdownItem.addEventListener('click', () => {
                                document.getElementById('query-input').value = data.query;
                                document.getElementById('is-native-checkbox').checked = data.isNative || false;
                                
                                // Load params
                                document.getElementById('params-container').innerHTML = '';
                                if (data.params) {
                                    Object.entries(data.params).forEach(([key, value]) => {
                                        addParamField(key, value);
                                    });
                                } else {
                                    // Auto detect params
                                    autoDetectedParams = detectQueryParams(data.query);
                                    updateParamsUI();
                                }
                            });
                            
                            favoriteQueriesList.appendChild(dropdownItem);
                        });
                    }
                    
                    // Update param sets list
                    function updateParamSetsUI(paramSets) {
                        const container = document.getElementById('param-sets-list');
                        container.innerHTML = '';
                        
                        if (!paramSets || Object.keys(paramSets).length === 0) {
                            container.innerHTML = '<div class="list-item">No saved parameter sets</div>';
                            return;
                        }
                        
                        Object.entries(paramSets).forEach(([name, params]) => {
                            const item = document.createElement('div');
                            item.className = 'list-item';
                            
                            const contentDiv = document.createElement('div');
                            contentDiv.style.width = '100%';
                            
                            const nameDiv = document.createElement('div');
                            nameDiv.textContent = name;
                            nameDiv.style.fontWeight = 'bold';
                            
                            const paramsDiv = document.createElement('div');
                            const paramKeys = Object.keys(params);
                            paramsDiv.textContent = paramKeys.length > 0 
                                ? \`\${paramKeys.slice(0, 3).join(', ')}\${paramKeys.length > 3 ? ' ...' : ''}\` 
                                : 'No parameters';
                            paramsDiv.style.fontSize = '11px';
                            
                            contentDiv.appendChild(nameDiv);
                            contentDiv.appendChild(paramsDiv);
                            
                            // Remove button
                            const removeBtn = document.createElement('button');
                            removeBtn.className = 'small secondary';
                            removeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                            removeBtn.title = 'Remove set';
                            
                            removeBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                vscode.postMessage({
                                    command: 'removeParamSet',
                                    name
                                });
                            });
                            
                            item.appendChild(contentDiv);
                            item.appendChild(removeBtn);
                            
                            // Click handler to load parameters
                            item.addEventListener('click', () => {
                                loadParamSet(name, params);
                                setActiveTab('query');
                            });
                            
                            container.appendChild(item);
                        });
                    }
                    
                    // Configuration
                    document.getElementById('add-package-btn').addEventListener('click', () => {
                        addEntityPackage('');
                    });
                    
                    function addEntityPackage(packageName) {
                        const container = document.getElementById('entity-packages-container');
                        const packageTag = document.createElement('div');
                        packageTag.className = 'package-tag';
                        
                        if (!packageName) {
                            // Create input for adding a new package
                            packageTag.innerHTML = \`
                                <input type="text" class="package-input" placeholder="Package name" style="width: 120px;">
                                <button class="confirm-package-btn" style="padding: 2px; background: none;">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                </button>
                            \`;
                            
                            container.appendChild(packageTag);
                            
                            const input = packageTag.querySelector('.package-input');
                            input.focus();
                            
                            input.addEventListener('keydown', (e) => {
                                if (e.key === 'Enter') {
                                    const value = input.value.trim();
                                    if (value) {
                                        packageTag.remove();
                                        addEntityPackage(value);
                                    }
                                } else if (e.key === 'Escape') {
                                    packageTag.remove();
                                }
                            });
                            
                            packageTag.querySelector('.confirm-package-btn').addEventListener('click', () => {
                                const value = input.value.trim();
                                if (value) {
                                    packageTag.remove();
                                    addEntityPackage(value);
                                }
                            });
                        } else {
                            // Create a display tag for an existing package
                            packageTag.innerHTML = \`
                                <span>\${packageName}</span>
                                <button class="remove-package-btn" style="padding: 0; background: none;">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            \`;
                            
                            container.appendChild(packageTag);
                            
                            packageTag.querySelector('.remove-package-btn').addEventListener('click', () => {
                                packageTag.remove();
                            });
                        }
                    }
                    
                    document.getElementById('save-config-btn').addEventListener('click', () => {
                        const config = {
                            dbConfig: {
                                url: document.getElementById('db-url').value,
                                username: document.getElementById('db-username').value,
                                password: document.getElementById('db-password').value,
                                driver: document.getElementById('db-driver').value
                            },
                            serverHost: document.getElementById('server-host').value,
                            serverPort: parseInt(document.getElementById('server-port').value) || 8089,
                            logLevel: document.getElementById('log-level').value,
                            entityLibPath: document.getElementById('entity-lib-path').value,
                            hibernateVersion: document.getElementById('hibernate-version').value,
                            projectScan: document.getElementById('project-scan-checkbox').checked
                        };
                        
                        // Get entity packages
                        const packageTags = document.querySelectorAll('.package-tag span');
                        const entityPackages = [];
                        packageTags.forEach(tag => {
                            entityPackages.push(tag.textContent);
                        });
                        config.entityPackages = entityPackages;
                        
                        vscode.postMessage({
                            command: 'saveConfiguration',
                            config
                        });
                    });
                    // Event listener for the Hibernate version select
                      document.getElementById('hibernate-version').addEventListener('change', function(event) {
                            const newVersion = event.target.value;
                            showNotification('For Hibernate version changes to take effect, please save and restart the VS Code!', 'info', 10000);
                    });
                    function updateConfigurationUI(config) {
                        if (!config) return;
                        
                        const dbConfig = config.dbConfig || {};
                        document.getElementById('db-url').value = dbConfig.url || '';
                        document.getElementById('db-username').value = dbConfig.username || '';
                        document.getElementById('db-password').value = dbConfig.password || '';
                        document.getElementById('db-driver').value = dbConfig.driver || '';
                        
                        // Server settings
                        document.getElementById('server-host').value = config.serverHost || '127.0.0.1';
                        document.getElementById('server-port').value = config.serverPort || 8089;
                        document.getElementById('log-level').value = config.logLevel || 'INFO';
                        
                        document.getElementById('entity-lib-path').value = config.entityLibPath || '';
                        document.getElementById('hibernate-version').value = config.hibernateVersion || '5.6.15';
                        document.getElementById('project-scan-checkbox').checked = config.projectScan !== undefined ? config.projectScan : true;
                        

                        // Clear and update entity packages
                        document.getElementById('entity-packages-container').innerHTML = '';
                        if (config.entityPackages && Array.isArray(config.entityPackages)) {
                            config.entityPackages.forEach(pkg => {
                                addEntityPackage(pkg);
                            });
                        }
                    }
                    
                    // Message handler
                    window.addEventListener('message', event => {
                        const message = event.data;
                        console.log('Message received in webview:', message.command);
                        
                        switch (message.command) {
                            case 'testQuery':
                                document.getElementById('query-input').value = message.query;
                                setActiveTab('query');
                                
                                // Determine if it's likely a native query (SQL)
                                const lowerQuery = message.query.toLowerCase();
                                const isLikelyNative = 
                                    lowerQuery.includes('select ') && 
                                    (lowerQuery.includes(' from ') || lowerQuery.includes('\\nfrom ')) &&
                                    !lowerQuery.includes(':');
                                
                                document.getElementById('is-native-checkbox').checked = isLikelyNative;
                                
                                // Detect parameters
                                autoDetectedParams = detectQueryParams(message.query);
                                updateParamsUI();
                                
                                // Load saved parameters for this query
                                vscode.postMessage({
                                    command: 'loadParams',
                                    query: message.query
                                });
                                break;
                                
                            case 'queryResult':
                                // Update UI to show query results
                                document.getElementById('result-placeholder').style.display = 'none';
                                document.getElementById('result-content').style.display = 'block';
                                
                                // Save the raw results for copying
                                currentResults = message.raw;
                                
                                // Update info section
                                const resultInfo = document.getElementById('result-info');
                                resultInfo.innerHTML = \`
                                    <div class="result-info-item">
                                        <span>Status:</span>
                                        <span class="badge \${message.status === 'SUCCESS' ? 'success' : 'error'}">\${message.status}</span>
                                    </div>
                                    <div class="result-info-item">
                                        <span>Time:</span>
                                        <span>\${message.executionTime}ms</span>
                                    </div>
                                    <div class="result-info-item">
                                        <span>Results:</span>
                                        <span>\${message.rowCount}</span>
                                    </div>
                                    <div class="result-info-item">
                                        <span>\${message.message}</span>
                                    </div>
                                \`;
                                
                                // Create results table
                                const tableContainer = document.getElementById('result-table-container');
                                
                                if (message.results && message.results.columns && message.results.columns.length > 0) {
                                    // Create table
                                    const table = document.createElement('table');
                                    table.className = 'result-table';
                                    
                                    // Create header
                                    const thead = document.createElement('thead');
                                    const headerRow = document.createElement('tr');
                                    
                                    message.results.columns.forEach(column => {
                                        const th = document.createElement('th');
                                        th.textContent = column;
                                        headerRow.appendChild(th);
                                    });
                                    
                                    thead.appendChild(headerRow);
                                    table.appendChild(thead);
                                    
                                    // Create body
                                    const tbody = document.createElement('tbody');
                                    
                                    message.results.rows.forEach(row => {
                                        const tr = document.createElement('tr');
                                        
                                        message.results.columns.forEach(column => {
                                            const td = document.createElement('td');
                                            const value = row[column];
                                            
                                            // Format value based on type
                                            if (value === null || value === undefined) {
                                                td.innerHTML = '<em style="opacity: 0.5;">null</em>';
                                            } else if (typeof value === 'object') {
                                                td.textContent = JSON.stringify(value);
                                            } else {
                                                td.textContent = value;
                                            }
                                            
                                            tr.appendChild(td);
                                        });
                                        
                                        tbody.appendChild(tr);
                                    });
                                    
                                    table.appendChild(tbody);
                                    tableContainer.innerHTML = '';
                                    tableContainer.appendChild(table);
                                } else {
                                    // No results
                                    tableContainer.innerHTML = '<p>No results found.</p>';
                                }
                                break;
                                
                            case 'queryError':
                                // Show error message
                                document.getElementById('result-placeholder').style.display = 'none';
                                document.getElementById('result-content').style.display = 'block';
                                
                                const errorInfo = document.getElementById('result-info');
                                errorInfo.innerHTML = \`
                                    <div class="result-info-item">
                                        <span>Status:</span>
                                        <span class="badge error">ERROR</span>
                                    </div>
                                \`;
                                
                                const errorContainer = document.getElementById('result-table-container');
                                errorContainer.innerHTML = \`
                                    <div style="color: var(--error-color);">
                                        <p><strong>Error:</strong> \${message.error}</p>
                                        <pre class="code" style="font-size: 11px;">\${message.stack || ''}</pre>
                                    </div>
                                \`;
                                break;
                                
                            case 'queryStatus':
                                if (message.status === 'loading') {
                                    document.getElementById('result-placeholder').innerHTML = '<div style="display:flex;align-items:center;gap:10px;"><div class="spinner"></div> Executing query...</div>';
                                    document.getElementById('result-placeholder').style.display = 'block';
                                    document.getElementById('result-content').style.display = 'none';
                                }
                                break;
                                
                            case 'formattedQuery':
                                document.getElementById('query-input').value = message.query;
                                break;
                                
                            case 'history':
                                console.log('Processing received history:', message);
                                // Check if the message contains queryHistory or queries (for compatibility)
                                queryHistory = message.queryHistory || message.queries || [];
                              
                                updateHistoryUI(queryHistory);
                                break;
                                
                            case 'params':
                                const savedParams = message.params;
                                
                                // Clear existing params and add saved ones
                                document.getElementById('params-container').innerHTML = '';
                                
                                if (savedParams && Object.keys(savedParams).length > 0) {
                                    Object.entries(savedParams).forEach(([key, value]) => {
                                        addParamField(key, value);
                                    });
                                } else {
                                    // Fall back to auto-detected params
                                    updateParamsUI();
                                }
                                break;
                                
                            case 'scannedQueries':
                                scannedQueries = message.queries;
                                updateScannedQueriesUI(scannedQueries);
                                break;
                                
                            case 'scanResult':
                                if (message.success) {
                                    showNotification(message.message, 'success');
                                    
                                    // Update scanned queries list
                                    scannedQueries = message.queries;
                                    updateScannedQueriesUI(scannedQueries);
                                    
                                    // Make sure scanned queries tab is active
                                    setActiveQueryList('scanned');
                                } else {
                                    showNotification(message.message, 'error');
                                }
                                break;
                                
                            case 'favorites':
                                favoriteQueries = message.favorites;
                                updateFavoritesUI(favoriteQueries);
                                break;
                                
                            case 'paramSets':
                                savedParamSets = message.paramSets;
                                updateParamSetsUI(savedParamSets);
                                break;
                                
                            case 'configuration':
                                updateConfigurationUI(message.config);
                                break;
                                
                            case 'configurationSaved':
                                showNotification(message.message, message.success ? 'success' : 'error');
                                break;
                                
                            case 'configurationError':
                                showNotification('Error loading configuration: ' + message.error, 'error');
                                break;
                                
                            case 'notification':
                                showNotification(message.message, message.type);
                                break;
                        }
                    });
                    
                    // Initial loads
                    vscode.postMessage({ command: 'loadHistory' });
                    vscode.postMessage({ command: 'loadScannedQueries' });
                    vscode.postMessage({ command: 'loadFavorites' });
                    vscode.postMessage({ command: 'loadParamSets' });
                    vscode.postMessage({ command: 'loadConfiguration' });
                })();
            </script>
        </body>
        </html>`;
    }

}
