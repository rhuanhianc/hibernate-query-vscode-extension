import { QueryInfo } from './types';

export class QueryUtils {
    
    /**
     * Scan text for queries (SQL, JPQL, HQL)
     * 
     * @param text - The text to scan for queries
     * @returns Array of QueryInfo objects
     */
    public scanQueries(text: string): QueryInfo[] {
        const queries: QueryInfo[] = [];

        // 1. Scan for String variable declarations (SQL, JPQL, HQL)
        const sqlDeclarationPattern = /String\s+(sql\w*|jpql|hql|consulta\w*)\s*=\s*([^;]*);/g;
        let match;

        while ((match = sqlDeclarationPattern.exec(text)) !== null) {
            const variableName = match[1].toLowerCase();
            const queryContent = match[2];

            // Determine if it's likely a native query based on variable naming
            const likelyNative = variableName.startsWith('sql') ||
                !variableName.includes('jpql') &&
                !variableName.includes('hql');

            const extractedQuery = this.extractQueryFromContent(queryContent, likelyNative);

            if (extractedQuery.query && !this.isDuplicateQuery(queries, extractedQuery.query)) {
                queries.push(extractedQuery);
            }
        }

        // 2. Scan for createQuery/createNativeQuery method calls
        const createQueryPattern = /(\.create(?:Native)?Query\s*\()([^;)]*)/g;

        while ((match = createQueryPattern.exec(text)) !== null) {
            const methodCall = match[1];
            const queryContent = match[2];

            // Determine if it's a native query from the method name
            const isNative = methodCall.includes('Native');

            const extractedQuery = this.extractQueryFromContent(queryContent, isNative);

            if (extractedQuery.query && !this.isDuplicateQuery(queries, extractedQuery.query)) {
                queries.push(extractedQuery);
            }
        }

        // 3. Scan for JPA annotations (@Query, @NamedQuery)
        const annotationPattern = /@(?:Named)?Query\s*\(\s*(?:name\s*=\s*["'].*?["']\s*,\s*)?(?:nativeQuery\s*=\s*(true|false)\s*,\s*)?(?:value\s*=\s*)?(["'].*?["'])/g;

        while ((match = annotationPattern.exec(text)) !== null) {
            const isNative = match[1]?.toLowerCase() === 'true';
            const queryContent = match[2];

            const extractedQuery = this.extractQueryFromContent(queryContent, isNative);

            if (extractedQuery.query && !this.isDuplicateQuery(queries, extractedQuery.query)) {
                queries.push(extractedQuery);
            }
        }

        return queries;
    }

    /**
     * Helper function to extract query from content that may contain string concatenation
     * 
     * @param content - The content potentially containing a query
     * @param isNative - Whether this is expected to be a native SQL query
     * @returns QueryInfo with the extracted query and its type
     */
    public extractQueryFromContent(content: string, isNative: boolean): QueryInfo {
        // Extract string literals from the content
        const extractResult = {
            query: '',
            isNative: isNative
        };

        // Handle string concatenation
        const parts = content.split(/\s*\+\s*/);
        let extractedContent = '';

        for (const part of parts) {
            // Extract content from quoted parts
            const stringMatch = part.match(/(['"])((?:\\\1|.)*?)\1/);
            if (stringMatch) {
                extractedContent += stringMatch[2];
            }
        }

        // Post-process the query
        if (extractedContent) {
            extractResult.query = this.processExtractedQuery(extractedContent, isNative);

            // If type wasn't explicitly specified, determine it based on query content
            if (isNative === null || isNative === undefined) {
                extractResult.isNative = this.determineIfNative(extractResult.query);
            }
        }

        return extractResult;
    }

    /**
     * Process extracted query to fix common issues like nested quotes
     * 
     * @param query - The extracted query
     * @param isNative - Whether it's a native SQL query
     * @returns Processed query
     */
    public processExtractedQuery(query: string, isNative: boolean): string {
        let processedQuery = query.trim();

        // Fix nested quotes in SQL functions if this is a native query
        if (isNative) {
            // Fix date format patterns in to_char function
            processedQuery = processedQuery.replace(/to_char\s*\(([^,]+),\s*'([^']+)(?!')/gi,
                (match, expr, format) => `to_char(${expr}, '${format}'`);

            // Fix unclosed quotes in date patterns
            if (processedQuery.includes("'YYYY") && !processedQuery.includes("'YYYY'")) {
                processedQuery = processedQuery.replace(/'YYYY(?!\s*')/g, "'YYYY'");
            }

            if (processedQuery.includes("'MM") && !processedQuery.includes("'MM'")) {
                processedQuery = processedQuery.replace(/'MM(?!\s*')/g, "'MM'");
            }

            if (processedQuery.includes("'DD") && !processedQuery.includes("'DD'")) {
                processedQuery = processedQuery.replace(/'DD(?!\s*')/g, "'DD'");
            }
        }

        return processedQuery;
    }

    /**
     * Helper function to determine if a query is native SQL or JPQL
     * 
     * @param query - The query to analyze
     * @returns boolean - True if likely native SQL, false if likely JPQL
     */
    public determineIfNative(query: string): boolean {
        // JPQL indicators
        const jpqlIndicators = [
            /JOIN\s+FETCH/i,                  // JOIN FETCH is specific to JPQL
            /\bMEMBER\s+OF\b/i,               // MEMBER OF is specific to JPQL
            /\bIS\s+EMPTY\b/i,                // IS EMPTY is specific to JPQL
            /\bNEW\s+[a-zA-Z0-9_.]+\s*\(/i,   // NEW constructor in JPQL
            /\bFROM\s+[A-Z][a-zA-Z0-9]*\b/i,  // Entity names in PascalCase
            /\.[a-zA-Z][a-zA-Z0-9]*\b/i       // Property access with dot notation
        ];

        // Native SQL indicators
        const nativeSqlIndicators = [
            /\b[a-z_]+\.[a-z_]+\.[a-z_]+\b/i, // Schema references like schema.table.column
            /\b[a-z_]+\.[a-z_]+\b/i,          // Table references with schema 
            /to_char\s*\(/i,                  // Oracle to_char function
            /\b[a-z_]+_[a-z_]+\b/i            // Snake case table/column names
        ];

        let jpqlScore = 0;
        let nativeScore = 0;

        // Check JPQL indicators
        for (const pattern of jpqlIndicators) {
            if (pattern.test(query)) {
                jpqlScore += 2;
            }
        }

        // Check native SQL indicators
        for (const pattern of nativeSqlIndicators) {
            if (pattern.test(query)) {
                nativeScore += 2;
            }
        }

        // Additional checks
        if (query.includes('_')) {
            nativeScore += 1; // Underscores common in SQL table/column names
        }

        // Check for JPA entity names (PascalCase)
        const entityJpaPattern = /\b[A-Z][a-zA-Z0-9]*\b(?!\s*\.)/g;
        const entityMatches = query.match(entityJpaPattern) || [];
        if (entityMatches.length > 0) {
            jpqlScore += 2;
        }

        return nativeScore >= jpqlScore;
    }

    /**
     * Format query for better display
     * 
     * @param query - The query to format
     * @returns Formatted query
     */
    public formatQueryScan(query: string): string {
        // Remove excessive whitespace and normalize line breaks
        return query.replace(/\s+/g, ' ').trim();
    }

    /**
     * Check if a query is already in the list (avoid duplicates)
     * 
     * @param queries - List of existing queries
     * @param newQuery - Query to check for duplication
     * @returns boolean - True if duplicate found
     */
    public isDuplicateQuery(queries: QueryInfo[], newQuery: string): boolean {
        const normalizedNewQuery = this.formatQueryScan(newQuery);
        return queries.some(q => this.formatQueryScan(q.query) === normalizedNewQuery);
    }
}