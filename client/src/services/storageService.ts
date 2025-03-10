import * as vscode from 'vscode';

export class StorageService {
    private context: vscode.ExtensionContext;
    private static readonly QUERY_HISTORY_KEY = 'queryHistory';
    private static readonly SCANNED_QUERIES_KEY = 'scannedQueries';
    private static readonly SAVED_PARAMS_KEY = 'savedParams';
    private static readonly FAVORITE_QUERIES_KEY = 'favoriteQueries';
    private static readonly PARAM_SETS_KEY = 'paramSets';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public getQueryHistory(): any[] {
        return this.context.globalState.get<any[]>(StorageService.QUERY_HISTORY_KEY, []);
    }

    public saveQuery(query: string, params: any = {}, isNative: boolean = false): void {
        const queryHistory = this.getQueryHistory();
        
        // Create new history item
        const historyItem = {
            query,
            params,
            isNative,
            timestamp: new Date().toISOString()
        };
        
        // Add to beginning of history
        queryHistory.unshift(historyItem);
        
        // Limit history length to 100 items
        if (queryHistory.length > 100) {
            queryHistory.pop();
        }
        
        // Save updated history
        this.context.globalState.update(StorageService.QUERY_HISTORY_KEY, queryHistory);
    }

    public clearQueries(): void {
        this.context.globalState.update(StorageService.QUERY_HISTORY_KEY, []);
    }

    public getScannedQueries(): string[] {
        return this.context.globalState.get<string[]>(StorageService.SCANNED_QUERIES_KEY, []);
    }

    public saveScannedQueries(queries: string[]): void {
        // Remove duplicates
        const uniqueQueries = [...new Set(queries)];
        this.context.globalState.update(StorageService.SCANNED_QUERIES_KEY, uniqueQueries);
    }

    public getSavedParams(): Record<string, any> {
        return this.context.globalState.get<Record<string, any>>(StorageService.SAVED_PARAMS_KEY, {});
    }

    public saveParams(query: string, params: any): void {
        const savedParams = this.getSavedParams();
        savedParams[query] = params;
        this.context.globalState.update(StorageService.SAVED_PARAMS_KEY, savedParams);
    }

    public getFavoriteQueries(): Record<string, any> {
        return this.context.globalState.get<Record<string, any>>(StorageService.FAVORITE_QUERIES_KEY, {});
    }

    public saveFavoriteQuery(name: string, query: string, params: any = {}, isNative: boolean = false): void {
        const favorites = this.getFavoriteQueries();
        favorites[name] = { query, params, isNative };
        this.context.globalState.update(StorageService.FAVORITE_QUERIES_KEY, favorites);
    }

    public removeFavoriteQuery(name: string): void {
        const favorites = this.getFavoriteQueries();
        if (favorites[name]) {
            delete favorites[name];
            this.context.globalState.update(StorageService.FAVORITE_QUERIES_KEY, favorites);
        }
    }

    public getParamSets(): Record<string, any> {
        return this.context.globalState.get<Record<string, any>>(StorageService.PARAM_SETS_KEY, {});
    }

    public saveParamSet(name: string, params: any): void {
        const paramSets = this.getParamSets();
        paramSets[name] = params;
        this.context.globalState.update(StorageService.PARAM_SETS_KEY, paramSets);
    }

    public removeParamSet(name: string): void {
        const paramSets = this.getParamSets();
        if (paramSets[name]) {
            delete paramSets[name];
            this.context.globalState.update(StorageService.PARAM_SETS_KEY, paramSets);
        }
    }
}