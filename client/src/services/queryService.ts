import { QueryClient } from '../queryClient';

export class QueryService {
    private queryClient: QueryClient;
    private serverPort: number;
    private serverHost: string;
    private hibernateVersion: string;

    constructor(serverPort: number = 8089, serverHost: string = '127.0.0.1') {
        this.serverPort = serverPort;
        this.serverHost = serverHost;
        this.hibernateVersion = '5.6.15'; // Default version
        this.queryClient = new QueryClient(this.serverPort);
    }

    public getServerPort(): number {
        return this.serverPort;
    }

    public getServerHost(): string {
        return this.serverHost;
    }
    
    public getHibernateVersion(): string {
        return this.hibernateVersion;
    }

    public async executeQuery(query: string, params: any, isNative: boolean = false, config: any = {}) {
        // Normalize query to allow for case insensitivity in keywords
        const normalizedQuery = this.normalizeQuery(query);
        
        // Set the hibernate version if provided
        if (config.hibernateVersion) {
            this.hibernateVersion = config.hibernateVersion;
        }

        // Use the dedicated method from QueryClient
        return await this.queryClient.executeQuery(
            normalizedQuery,
            params,
            isNative,
            config
        );
    }

    public normalizeQuery(query: string): string {
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

    public formatResults(results: any[]): any {
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

    public formatQuery(query: string): string {
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

        return finalQuery;
    }
}