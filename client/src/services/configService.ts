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
        const configuration = vscode.workspace.getConfiguration('queryTester');
        Object.keys(config).forEach(key => {
            configuration.update(key, config[key], vscode.ConfigurationTarget.Global);
            
        });
    }
}