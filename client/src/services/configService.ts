import * as vscode from 'vscode';
import { StorageService } from './storageService';

export class ConfigService {
    private storageService: StorageService;

    constructor(storageService: StorageService) {
        this.storageService = storageService;
    }

    public loadConfiguration(): any {
        const config = vscode.workspace.getConfiguration('queryTester');

        return {
            dbConfig: config.get('dbConfig'),
            serverHost: config.get('serverHost'),
            serverPort: config.get('serverPort'),
            logLevel: config.get('logLevel'),
            entityLibPath: config.get('entityLibPath'),
            entityPackages: config.get('entityPackages'),
            projectScan: config.get('projectScan'),
            hibernateVersion: config.get('hibernateVersion')
        };
    }

    public saveConfiguration(config: any): void {
        // Update VS Code settings
        const configuration = vscode.workspace.getConfiguration('queryTester');

        // Update each property
        Object.keys(config).forEach(key => {
            if (key === 'dbConfig') {
                // dbConfig is an object, so we need to update its properties individually
                const dbConfig = config[key];
                if (dbConfig) {
                    Object.keys(dbConfig).forEach(dbKey => {
                        configuration.update(`dbConfig.${dbKey}`, dbConfig[dbKey], vscode.ConfigurationTarget.Global);
                    });
                }
            } else {
                configuration.update(key, config[key], vscode.ConfigurationTarget.Global);
            }
        });
    }
}