import * as vscode from 'vscode';
import { QueryService } from '../services/queryService';
import { StorageService } from '../services/storageService';
import { WebviewContentProvider } from './webviewContentProvider';
import { ConfigService } from '../services/configService';
import { QueryUtils } from '../utils/queryUtils';
import { QueryInfo } from '../utils/types';

export class SidebarProvider implements vscode.WebviewViewProvider {
    private _webview?: vscode.Webview;
    private queryService: QueryService;
    private storageService: StorageService;
    private contentProvider: WebviewContentProvider;
    private configService: ConfigService;
    private queryUtils: QueryUtils;

    constructor(context: vscode.ExtensionContext, serverPort?: number) {
        // Initialize services
        this.storageService = new StorageService(context);
        
        // Get configured port or use default
        if (!serverPort) {
            const config = vscode.workspace.getConfiguration('queryTester');
            serverPort = config.get<number>('serverPort') || 8089;
        }
        
        this.queryService = new QueryService(serverPort);
        this.contentProvider = new WebviewContentProvider(context);
        this.configService = new ConfigService(this.storageService);
        this.queryUtils = new QueryUtils();
    }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._webview = webviewView.webview;

        // Configure webview
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..', 'media'),
                vscode.Uri.joinPath(vscode.Uri.file(__dirname), 'webview')
            ]
        };

        // Load webview content
        webviewView.webview.html = this.contentProvider.getWebviewContent(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log(`Received message from webview: ${message.command}`);
            await this.handleWebviewMessage(message);
        });

        // Load initial data
        this.loadInitialData();
    }

    private async handleWebviewMessage(message: any) {
        switch (message.command) {
            case 'executeQuery':
                await this.executeQuery(message.query, message.params, message.saveParams, message.isNative);
                break;
            case 'formatQuery':
                this.formatQuery(message.query);
                break;
            case 'loadHistory':
                this.loadQueryHistory();
                break;
            case 'loadParams':
                this.loadParams(message.query);
                break;
            case 'loadScannedQueries':
                this.loadScannedQueries();
                break;
            case 'scanQueries':
                this.scanQueries();
                break;
            case 'saveConfiguration':
                this.saveConfiguration(message.config);
                break;
            case 'loadConfiguration':
                this.loadConfiguration();
                break;
            case 'clearQueryHistory':
                this.clearQueryHistory();
                break;
            case 'saveFavoriteQuery':
                this.saveFavoriteQuery(message.name, message.query, message.params, message.isNative);
                break;
            case 'loadFavorites':
                this.loadFavorites();
                break;
            case 'removeFavoriteQuery':
                this.removeFavoriteQuery(message.name);
                break;
            case 'saveParamSet':
                this.saveParamSet(message.name, message.params);
                break;
            case 'loadParamSets':
                this.loadParamSets();
                break;
            case 'removeParamSet':
                this.removeParamSet(message.name);
                break;
        }
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

    private async executeQuery(query: string, params: any, saveParams: boolean, isNative: boolean = false) {
        try {
            // Show loading indicator
            this.postMessage({ command: 'queryStatus', status: 'loading' });

            // Get configuration
            const config = vscode.workspace.getConfiguration('queryTester');
            
            // Execute query
            const response = await this.queryService.executeQuery(
                query,
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
            this.storageService.saveQuery(query, params, isNative);
            if (saveParams) this.storageService.saveParams(query, params);

            // Format results for display
            const results = response.results || [];
            const formattedResults = this.queryService.formatResults(results);

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

    private formatQuery(query: string) {
        try {
            const formattedQuery = this.queryService.formatQuery(query);
            this.postMessage({ command: 'formattedQuery', query: formattedQuery });
        } catch (e) {
            console.error('Error formatting query:', e);
            // If formatting fails, return the original query
            this.postMessage({ command: 'formattedQuery', query });
        }
    }

    private scanQueries() {
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
        const queries = this.queryUtils.scanQueries(text);

        if (queries.length > 0) {
            // Format results for display/storage
            const queryStrings = queries.map(q => this.queryUtils.formatQueryScan(q.query) as string);
            this.storageService.saveScannedQueries(queryStrings);

            // Count of each type for the message
            const nativeCount = queries.filter(q => q.isNative).length;
            const jpqlCount = queries.length - nativeCount;

            this.postMessage({
                command: 'scanResult',
                success: true,
                queries: queryStrings,
                message: `Found ${queries.length} queries (${nativeCount} SQL, ${jpqlCount} JPQL) in the document.`
            });
        } else {
            this.postMessage({
                command: 'scanResult',
                success: false,
                message: 'No queries found in the document.'
            });
        }
    }

    private loadQueryHistory() {
        const queryHistory = this.storageService.getQueryHistory();
        console.log(`History loaded: ${queryHistory.length} items`);
        this.postMessage({
            command: 'history',
            queryHistory: queryHistory
        });
    }

    private loadParams(query: string) {
        this.postMessage({
            command: 'params',
            params: this.storageService.getSavedParams()[query] || {}
        });
    }

    private loadScannedQueries() {
        this.postMessage({
            command: 'scannedQueries',
            queries: this.storageService.getScannedQueries()
        });
    }

    private loadConfiguration() {
        try {
            const config = this.configService.loadConfiguration();
            this.postMessage({
                command: 'configuration',
                config: config
            });
        } catch (e: any) {
            this.postMessage({
                command: 'configurationError',
                error: e.message
            });
        }
    }

    private saveConfiguration(config: any) {
        try {
            this.configService.saveConfiguration(config);
            
            // Check if server settings changed
            const currentPort = this.queryService.getServerPort();
            const currentHost = this.queryService.getServerHost();
            const currentHibernateVersion = this.queryService.getHibernateVersion();
            
            const serverPortUpdated = config.serverPort !== currentPort;
            const serverHostUpdated = config.serverHost !== currentHost;
            const hibernateVersionUpdated = config.hibernateVersion !== currentHibernateVersion;
            
            const message = serverPortUpdated || serverHostUpdated || hibernateVersionUpdated
                ? 'Configuration saved successfully. It is necessary to restart the extension to apply server changes.'
                : 'Configuration saved successfully.';

            this.postMessage({
                command: 'configurationSaved',
                success: true,
                message: message
            });

            // If the server port or host has changed or the Hibernate version has changed, prompt the user to restart
            if (serverPortUpdated || serverHostUpdated || hibernateVersionUpdated) {
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

    private clearQueryHistory() {
        try {
            this.storageService.clearQueries();
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

    private saveFavoriteQuery(name: string, query: string, params: any, isNative: boolean) {
        try {
            this.storageService.saveFavoriteQuery(name, query, params, isNative);
            this.loadFavorites();
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

    private loadFavorites() {
        const favorites = this.storageService.getFavoriteQueries();
        this.postMessage({
            command: 'favorites',
            favorites: favorites
        });
    }

    private removeFavoriteQuery(name: string) {
        this.storageService.removeFavoriteQuery(name);
        this.loadFavorites();
    }

    private saveParamSet(name: string, params: any) {
        try {
            this.storageService.saveParamSet(name, params);
            this.loadParamSets();
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

    private loadParamSets() {
        const paramSets = this.storageService.getParamSets();
        this.postMessage({
            command: 'paramSets',
            paramSets: paramSets
        });
    }

    private removeParamSet(name: string) {
        this.storageService.removeParamSet(name);
        this.loadParamSets();
    }

    private loadInitialData() {
        try {
            console.log('Loading initial data...');

            // Load history
            const queryHistory = this.storageService.getQueryHistory();
            console.log(`Loading history: ${queryHistory.length} items`);
            this.postMessage({ command: 'history', queryHistory: queryHistory });

            // Load scanned queries
            const scannedQueries = this.storageService.getScannedQueries();
            console.log(`Loading scanned queries: ${scannedQueries.length} items`);
            this.postMessage({ command: 'scannedQueries', queries: scannedQueries });

            // Load favorites
            const favorites = this.storageService.getFavoriteQueries();
            console.log(`Loading favorites: ${Object.keys(favorites).length} items`);
            this.postMessage({ command: 'favorites', favorites: favorites });

            // Load parameter sets
            const paramSets = this.storageService.getParamSets();
            console.log(`Loading parameter sets: ${Object.keys(paramSets).length} items`);
            this.postMessage({ command: 'paramSets', paramSets: paramSets });
        } catch (error) {
            console.error('Error loading initial data:', error);
        }

        // Load initial configuration
        this.loadConfiguration();
    }
}