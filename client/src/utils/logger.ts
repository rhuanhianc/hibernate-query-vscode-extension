import * as vscode from 'vscode';

export enum LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4
}

export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel = LogLevel.INFO;

    // Cache to avoid flooding the log with duplicate messages
    private lastLogMessage: string = '';
    private duplicateCount: number = 0;
    private lastLogTime: number = 0;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Hibernate Query Tester', 'log');

        // Get configured log level from settings
        const config = vscode.workspace.getConfiguration('queryTester');
        const configLevel = config.get<string>('logLevel') || 'INFO';
        this.setLogLevel(configLevel);

        // Register for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('queryTester.logLevel')) {
                const newLevel = vscode.workspace.getConfiguration('queryTester').get<string>('logLevel') || 'INFO';
                this.setLogLevel(newLevel);
            }
        });

        this.logHeader();

        // Show the log channel when extension starts
        this.outputChannel.show(true);
    }

    private logHeader(): void {
        const timestamp = new Date().toISOString();
        const header = [
            `═══════════════════════════════════════════════════════════════════════════════`,
            `    HIBERNATE QUERY TESTER LOGS                                    ${timestamp}`,
            `═══════════════════════════════════════════════════════════════════════════════`,
            `Log level: ${LogLevel[this.logLevel]}`,
            ''
        ];

        header.forEach(line => this.outputChannel.appendLine(line));
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public setLogLevel(level: string): void {
        const oldLevel = this.logLevel;

        switch (level.toUpperCase()) {
            case 'TRACE': this.logLevel = LogLevel.TRACE; break;
            case 'DEBUG': this.logLevel = LogLevel.DEBUG; break;
            case 'INFO': this.logLevel = LogLevel.INFO; break;
            case 'WARN': this.logLevel = LogLevel.WARN; break;
            case 'ERROR': this.logLevel = LogLevel.ERROR; break;
            default: this.logLevel = LogLevel.INFO;
        }

        if (oldLevel !== this.logLevel) {
            const message = `Log level changed from ${LogLevel[oldLevel]} to ${LogLevel[this.logLevel]}`;
            this.outputChannel.appendLine(message);
        }
    }

    public trace(message: string): void {
        this.log(LogLevel.TRACE, message);
    }

    public debug(message: string): void {
        this.log(LogLevel.DEBUG, message);
    }

    public info(message: string): void {
        this.log(LogLevel.INFO, message);
    }

    public warn(message: string): void {
        this.log(LogLevel.WARN, message);
    }

    public error(message: string): void {
        this.log(LogLevel.ERROR, message);
    }

    private getLevelIndicator(level: LogLevel): string {
        switch (level) {
            case LogLevel.TRACE: return "TRACE";
            case LogLevel.DEBUG: return "DEBUG";
            case LogLevel.INFO: return "INFO ";
            case LogLevel.WARN: return "WARN ";
            case LogLevel.ERROR: return "ERROR";
            default: return "INFO ";
        }
    }

    private log(level: LogLevel, message: string): void {
        // Only logs if the level is greater than or equal to the configured level
        if (level >= this.logLevel) {
            const now = Date.now();
            const timestamp = new Date().toISOString();

            // Prevents duplicate logs in sequence
            if (message === this.lastLogMessage && now - this.lastLogTime < 1000) {
                this.duplicateCount++;
                if (this.duplicateCount <= 5 || this.duplicateCount % 10 === 0) {
                    this.outputChannel.appendLine(`[repeated ${this.duplicateCount} times]`);
                }
                return;
            } else if (this.duplicateCount > 0) {
                this.duplicateCount = 0;
            }

            // Format the log message
            const formattedTime = timestamp.split('T')[1].replace('Z', '');
            const formattedMessage = `[${formattedTime}] [${this.getLevelIndicator(level)}] ${message}`;

            this.outputChannel.appendLine(formattedMessage);

            // Update cache for duplicate detection
            this.lastLogMessage = message;
            this.lastLogTime = now;
        }
    }

    /**
    * Parses and formats a Java server log
    */
    public parseServerLog(logMessage: string): void {
        try {
            let logLevel = LogLevel.INFO;

            if (logMessage.includes('[ERROR]') || logMessage.includes('Error:') || logMessage.match(/ERROR\s+[a-zA-Z0-9.]+/)) {
                logLevel = LogLevel.ERROR;
            } else if (logMessage.includes('[WARN]') || logMessage.includes('Warning:') || logMessage.match(/WARN\s+[a-zA-Z0-9.]+/)) {
                logLevel = LogLevel.WARN;
            } else if (logMessage.includes('[DEBUG]') || logMessage.includes('Debug:') || logMessage.match(/DEBUG\s+[a-zA-Z0-9.]+/)) {
                logLevel = LogLevel.DEBUG;
            } else if (logMessage.includes('[TRACE]') || logMessage.includes('Trace:') || logMessage.match(/TRACE\s+[a-zA-Z0-9.]+/)) {
                logLevel = LogLevel.TRACE;
            }
            let cleanedMessage = logMessage;

            // Hibernate default: "HH:mm:ss.SSS [thread-name] LEVEL class.name - Message"
            const hibernateLogPattern = /(\d{2}:\d{2}:\d{2}\.\d{3})\s+\[([^\]]+)\]\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+([a-zA-Z0-9.]+)\s+-\s+(.*)/;
            const hibernateMatch = logMessage.match(hibernateLogPattern);

            if (hibernateMatch) {
                // Extract components from the Hibernate log
                const [, time, thread, level, className, message] = hibernateMatch;

                let formattedMessage = '';

                const threadInfo = thread.length > 15 ? thread.substring(0, 12) + '...' : thread;

                if (className.includes('hibernate') || className.includes('jpa') ||
                    className.includes('querytester') || message.includes('Hibernate:')) {
                    // For important logs, include the thread
                    formattedMessage = `[${threadInfo}] ${className} - ${message}`;
                } else {
                    formattedMessage = `${className} - ${message}`;
                }

                this.log(this.getLogLevelFromString(level), formattedMessage);
                return;
            }

            // Check if it is a log with embedded JSON
            if (logMessage.includes('{') && logMessage.includes('}')) {
                try {
                    const jsonStart = logMessage.indexOf('{');
                    const jsonEnd = logMessage.lastIndexOf('}') + 1;
                    const jsonPart = logMessage.substring(jsonStart, jsonEnd);
                    const json = JSON.parse(jsonPart);

                    const preMessage = logMessage.substring(0, jsonStart).trim();

                    const formattedJson = JSON.stringify(json, null, 2);

                    // If the JSON is too small, display it on the same line
                    if (formattedJson.length < 80 && !formattedJson.includes('\n')) {
                        this.log(logLevel, `${preMessage} ${formattedJson}`);
                    } else {
                        if (json.status === 'ERROR') {
                            this.error(`${preMessage}`);
                            this.error(`${formattedJson}`);
                        } else {
                            this.log(logLevel, `${preMessage}`);
                            this.log(logLevel, `${formattedJson}`);
                        }
                    }
                    return;
                } catch (e) {
                    // ignore
                }
            }

            this.log(logLevel, cleanedMessage);

        } catch (e) {
            this.info(logMessage);
        }
    }

    /**
    * Converts a level string to the LogLevel enum
    */
    private getLogLevelFromString(level: string): LogLevel {
        switch (level.toUpperCase()) {
            case 'TRACE': return LogLevel.TRACE;
            case 'DEBUG': return LogLevel.DEBUG;
            case 'INFO': return LogLevel.INFO;
            case 'WARN': return LogLevel.WARN;
            case 'ERROR': return LogLevel.ERROR;
            default: return LogLevel.INFO;
        }
    }

    /**
    * Shows the log output channel.
    * @param preserveFocus If true, does not change the focus (default: false)
    */
    public show(preserveFocus: boolean = false): void {
        this.outputChannel.show(preserveFocus);
        this.info("Log panel opened");
    }

    /**
    * Clears the log output channel.
    */
    public clear(): void {
        this.outputChannel.clear();
        this.logHeader();
        this.info("Logs cleared");
    }
}