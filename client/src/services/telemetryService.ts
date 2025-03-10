import * as vscode from 'vscode';
import TelemetryReporter from '@vscode/extension-telemetry';
import { config } from '../config/config.real';
import { Logger } from '../utils/logger';

/**
 * Telemetry Service for Hibernate Query Tester
 */
export class TelemetryService {
    private static instance: TelemetryService;
    private reporter: TelemetryReporter | undefined;
    private enabled: boolean = true;
    private logger: Logger;
    private context: vscode.ExtensionContext | undefined;
    
    // Keys to store telemetry information
    private readonly INSTALL_KEY = 'hibernate-query-tester.installed';
    private readonly TELEMETRY_INFO_KEY = 'hibernate-query-tester.telemetryInfoShown';

    private constructor() {
        this.logger = Logger.getInstance();
        this.initialize();
    }

    /**
     * Get the singleton instance of the telemetry service
     */
    public static getInstance(): TelemetryService {
        if (!TelemetryService.instance) {
            TelemetryService.instance = new TelemetryService();
        }
        return TelemetryService.instance;
    }

    /**
     * Initialize the telemetry service
     */
    private initialize(): void {
        try {
            // Check if telemetry is disabled
            const isOptedOut = 
                vscode.env.isTelemetryEnabled === false || 
                vscode.workspace.getConfiguration('queryTester').get<boolean>('telemetry.enabled') === false;

            this.enabled = !isOptedOut;

            if (!config.telemetryKey) {
                this.logger.debug('Telemetry key not configured');
                this.enabled = false;
                return;
            }

            // Only initialize if enabled
            if (this.enabled) {
                // Updated version: uses only the telemetry key directly
                this.reporter = new TelemetryReporter(config.telemetryKey);
                this.logger.debug('Telemetry initialized');
                
                // Monitor configuration changes
                vscode.workspace.onDidChangeConfiguration(e => {
                    if (e.affectsConfiguration('queryTester.telemetry.enabled') || 
                        e.affectsConfiguration('telemetry.enableTelemetry')) {
                        this.checkTelemetryState();
                    }
                });
            } else {
                this.logger.debug('Telemetry disabled by the user');
            }
        } catch (err: any) {
            this.logger.error(`Error initializing telemetry: ${err.message}`);
            this.enabled = false;
        }
    }

    /**
     * Check if telemetry is still enabled after configuration changes
     */
    private checkTelemetryState(): void {
        const isOptedOut = 
            vscode.env.isTelemetryEnabled === false || 
            vscode.workspace.getConfiguration('queryTester').get<boolean>('telemetry.enabled') === false;

        this.enabled = !isOptedOut;
        this.logger.debug(`Telemetry state changed: ${this.enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Set extension context to check installation
     */
    public setExtensionContext(context: vscode.ExtensionContext): void {
        this.context = context;
        this.checkFirstRun();
        this.showTelemetryNotice();
    }

    /**
     * Check if it's the first run to send installation event
     */
    private checkFirstRun(): void {
        if (!this.enabled || !this.reporter || !this.context) {
            return;
        }
        
        const isInstalled = this.context.globalState.get(this.INSTALL_KEY);
        
        if (!isInstalled) {
            // Send installation event
            this.reporter.sendTelemetryEvent('extension.installed');
            this.context.globalState.update(this.INSTALL_KEY, true);
            this.logger.debug('Installation event recorded');
        }
    }

    /**
     * Show telemetry notification on first run
     */
    private showTelemetryNotice(): void {
        if (!this.context) {
            return;
        }
        
        const noticeShown = this.context.globalState.get(this.TELEMETRY_INFO_KEY);
        
        if (!noticeShown) {
            vscode.window.showInformationMessage(
                'Hibernate Query Tester collects anonymous usage data to improve the extension. You can disable this in the settings.',
                'OK', 'Disable'
            ).then(selection => {
                 if (selection === 'Disable') {
                    vscode.workspace.getConfiguration().update(
                        'queryTester.telemetry.enabled', 
                        false, 
                        vscode.ConfigurationTarget.Global
                    );
                }
            });
            
            this.context.globalState.update(this.TELEMETRY_INFO_KEY, true);
        }
    }

    /**
     * Record extension activation
     */
    public sendActivationEvent(): void {
        if (this.enabled && this.reporter) {
            this.reporter.sendTelemetryEvent('extension.activated');
            this.logger.debug('Activation event recorded');
        }
    }

    /**
     * Record query execution (without details)
     */
    public sendQueryExecutedEvent(isNative: boolean): void {
        if (this.enabled && this.reporter) {
            this.reporter.sendTelemetryEvent('query.executed', {
                type: isNative ? 'native' : 'jpql'
            });
            this.logger.debug(`Query event recorded (${isNative ? 'native' : 'jpql'})`);
        }
    }

    /**
     * Record connection error (without sensitive details)
     */
    public sendConnectionErrorEvent(): void {
        if (this.enabled && this.reporter) {
            this.reporter.sendTelemetryEvent('connection.error');
            this.logger.debug('Connection error event recorded');
        }
    }

    /**
     * Record successful connection
     */
    public sendConnectionSuccessEvent(): void {
        if (this.enabled && this.reporter) {
            this.reporter.sendTelemetryEvent('connection.success');
            this.logger.debug('Successful connection event recorded');
        }
    }

    /**
     * Release resources when deactivating the extension
     */
    public dispose(): void {
        if (this.reporter) {
            this.reporter.dispose();
            this.reporter = undefined;
            this.logger.debug('Telemetry deactivated');
        }
    }
}