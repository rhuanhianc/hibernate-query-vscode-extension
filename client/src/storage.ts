import * as vscode from 'vscode';

export class Storage {
    private context: vscode.ExtensionContext;
    private readonly MAX_HISTORY_SIZE = 50;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public saveQuery(query: string, params: any = {}, isNative: boolean = false) {
        const queryHistory = this.getQueryHistory();
        
        // Remove if exists to move to top
        const existingIndex = queryHistory.findIndex(item => item.query === query);
        if (existingIndex > -1) {
            queryHistory.splice(existingIndex, 1);
        }
        
        // Add to beginning with params and native flag
        queryHistory.unshift({
            query,
            params,
            isNative,
            timestamp: new Date().toISOString()
        });
        
        // Limit size
        if (queryHistory.length > this.MAX_HISTORY_SIZE) {
            queryHistory.pop();
        }
        
        this.context.globalState.update('queryHistoryWithParams', queryHistory);
        
        // Keep backward compatibility with old history
        const queries = queryHistory.map(item => item.query);
        this.context.globalState.update('queryHistory', queries);
    }

    public getQueries(): string[] {
        const queryHistory = this.getQueryHistory();
        // Extract only queries from history to maintain compatibility
        return queryHistory.map(item => {
            return typeof item === 'string' ? item : item.query;
        });
    }
    
    public getQueryHistory(): Array<{query: string, params: any, isNative: boolean, timestamp: string}> {
        const savedHistory = this.context.globalState.get('queryHistoryWithParams', []);
        
        // If history is empty, try loading the old format and convert it
        if (!savedHistory || savedHistory.length === 0) {
            const oldQueries = this.context.globalState.get('queryHistory', []);
            if (oldQueries && oldQueries.length > 0) {
                console.log('Converting old history to new format...');
                
                // Convert old queries to new format
                const convertedHistory = oldQueries.map((query: string) => ({
                    query,
                    params: {},
                    isNative: false,
                    timestamp: new Date().toISOString()
                }));
                
                // Save in the new format
                this.context.globalState.update('queryHistoryWithParams', convertedHistory);
                return convertedHistory;
            }
        }
        
        console.log(`History loaded: ${savedHistory ? savedHistory.length : 0} items`);
        return savedHistory || [];
    }

    public clearQueries() {
        this.context.globalState.update('queryHistory', []);
        this.context.globalState.update('queryHistoryWithParams', []);
    }

    public saveParams(query: string, params: any) {
        const savedParams = this.getSavedParams();
        savedParams[query] = params;
        this.context.globalState.update('savedParams', savedParams);
    }

    public getSavedParams(): { [query: string]: any } {
        return this.context.globalState.get('savedParams', {});
    }

    public clearParams() {
        this.context.globalState.update('savedParams', {});
    }

    public saveFavoriteQuery(name: string, query: string, params: any = {}, isNative: boolean = false) {
        const favorites = this.getFavoriteQueries();
        favorites[name] = { query, params, isNative };
        this.context.globalState.update('favoriteQueries', favorites);
    }

    public getFavoriteQueries(): { [name: string]: { query: string, params: any, isNative: boolean } } {
        return this.context.globalState.get('favoriteQueries', {});
    }

    public removeFavoriteQuery(name: string) {
        const favorites = this.getFavoriteQueries();
        if (favorites[name]) {
            delete favorites[name];
            this.context.globalState.update('favoriteQueries', favorites);
        }
    }

    // Save named parameter sets for reuse
    public saveParamSet(name: string, params: any) {
        const paramSets = this.getParamSets();
        paramSets[name] = params;
        this.context.globalState.update('paramSets', paramSets);
    }

    public getParamSets(): { [name: string]: any } {
        return this.context.globalState.get('paramSets', {});
    }

    public removeParamSet(name: string) {
        const paramSets = this.getParamSets();
        if (paramSets[name]) {
            delete paramSets[name];
            this.context.globalState.update('paramSets', paramSets);
        }
    }

    // Save scanned queries separately from history
    public saveScannedQueries(queries: string[]) {
        this.context.globalState.update('scannedQueries', queries);
    }

    public getScannedQueries(): string[] {
        return this.context.globalState.get('scannedQueries', []);
    }

    public clearScannedQueries() {
        this.context.globalState.update('scannedQueries', []);
    }
}