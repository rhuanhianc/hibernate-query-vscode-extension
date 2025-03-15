const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Simular o ambiente do navegador com JSDOM
function setupJsdom() {
  // Criar um DOM virtual
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Query Tester</title>
    </head>
    <body>
      <!-- Tabs -->
      <div id="tabs-container">
        <button class="tab active" data-tab="query">Query</button>
        <button class="tab" data-tab="history">History</button>
        <button class="tab" data-tab="favorites">Favorites</button>
        <button class="tab" data-tab="params">Parameters</button>
        <button class="tab" data-tab="config">Configuration</button>
      </div>
      
      <!-- Tab content -->
      <div id="query-tab" class="tab-content active">
        <textarea id="query-input"></textarea>
        <div id="query-actions">
          <button id="execute-btn">Execute</button>
          <button id="format-btn">Format</button>
          <button id="clear-query-btn">Clear</button>
          <button id="scan-btn">Scan Queries</button>
          <button id="save-favorite-btn">Save as Favorite</button>
          <div>
            <input type="checkbox" id="is-native-checkbox">
            <label for="is-native-checkbox">Native SQL</label>
          </div>
        </div>
        
        <div class="query-lists">
          <div class="query-lists-tabs">
            <button class="query-lists-tab active" data-list="scanned">Scanned Queries</button>
            <button class="query-lists-tab" data-list="favorite">Favorite Queries</button>
          </div>
          
          <div id="scanned-queries-list" class="query-lists-content active"></div>
          <div id="favorite-queries-list" class="query-lists-content"></div>
        </div>
        
        <div id="params-section">
          <div class="section-header">
            <h3>Parameters</h3>
            <div>
              <button id="add-param-btn">Add</button>
              <button id="save-param-set-btn">Save Set</button>
              <button id="load-param-set-btn">Load Set</button>
              <input type="checkbox" id="save-params-checkbox" checked>
              <label for="save-params-checkbox">Remember</label>
            </div>
          </div>
          <div id="params-container"></div>
        </div>
        
        <div id="result-section">
          <div id="result-placeholder">Execute a query to see results</div>
          <div id="result-content" style="display: none;">
            <div class="result-header">
              <div id="result-info"></div>
              <button id="copy-results-btn">Copy Results</button>
            </div>
            <div id="result-table-container"></div>
            <div id="pagination-controls" style="display: none;">
              <button id="prev-page-btn">Previous</button>
              <span id="page-info">Page 1 of 1</span>
              <button id="next-page-btn">Next</button>
            </div>
          </div>
        </div>
      </div>
      
      <div id="history-tab" class="tab-content">
        <div class="section-header">
          <h3>Query History</h3>
          <button id="clear-history-btn">Clear History</button>
        </div>
        <div id="history-list"></div>
      </div>
      
      <div id="favorites-tab" class="tab-content">
        <div id="favorites-list"></div>
      </div>
      
      <div id="params-tab" class="tab-content">
        <div id="param-sets-list"></div>
      </div>
      
      <div id="config-tab" class="tab-content">
        <!-- DB Config -->
        <div class="config-section">
          <h3>Database Configuration</h3>
          <div class="form-group">
            <label for="db-url">JDBC URL</label>
            <input type="text" id="db-url" placeholder="jdbc:postgresql://localhost:5432/dbname">
          </div>
          <div class="form-group">
            <label for="db-username">Username</label>
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
        
        <!-- Server Config -->
        <div class="config-section">
          <h3>Server Configuration</h3>
          <div class="form-group">
            <label for="server-host">Host</label>
            <input type="text" id="server-host" value="127.0.0.1">
          </div>
          <div class="form-group">
            <label for="server-port">Port</label>
            <input type="number" id="server-port" value="8089">
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
        </div>
        
        <!-- Hibernate Config -->
        <div class="config-section">
          <h3>Hibernate Configuration</h3>
          <div class="form-group">
            <label for="entity-lib-path">Entity Library Path</label>
            <input type="text" id="entity-lib-path" placeholder="/path/to/entity-jar.jar">
          </div>
          <div class="form-group">
            <label for="hibernate-version">Hibernate Version</label>
            <select id="hibernate-version">
              <option value="6.2.7.Final">6.2.7.Final</option>
              <option value="6.2.0.Final">6.2.0.Final</option>
              <option value="6.1.7.Final">6.1.7.Final</option>
              <option value="6.1.0.Final">6.1.0.Final</option>
              <option value="6.0.0.Final">6.0.0.Final</option>
              <option value="5.6.15.Final">5.6.15.Final</option>
              <option value="5.6.0.Final">5.6.0.Final</option>
              <option value="5.5.0.Final">5.5.0.Final</option>
              <option value="5.4.33.Final">5.4.33.Final</option>
              <option value="5.4.30.Final">5.4.30.Final</option>
              <option value="5.4.0.Final">5.4.0.Final</option>
              <option value="5.3.26.Final">5.3.26.Final</option>
            </select>
          </div>
          <div class="form-group">
            <label for="project-scan-checkbox">Auto-scan Project Entities</label>
            <input type="checkbox" id="project-scan-checkbox" checked>
          </div>
        </div>
        
        <!-- Entity Packages -->
        <div class="config-section">
          <h3>Entity Packages</h3>
          <div id="entity-packages-container"></div>
          <button id="add-package-btn">Add Package</button>
        </div>
        
        <button id="save-config-btn" class="primary">Save Configuration</button>
      </div>
      
      <!-- Modals -->
      <div id="save-favorite-modal" class="modal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Save as Favorite</h3>
            <span class="close-btn">&times;</span>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label for="favorite-name">Name</label>
              <input type="text" id="favorite-name" placeholder="Enter a name for this query">
            </div>
          </div>
          <div class="modal-footer">
            <button id="cancel-save-favorite" class="secondary">Cancel</button>
            <button id="confirm-save-favorite" class="primary">Save</button>
          </div>
        </div>
      </div>
      
      <div id="save-param-set-modal" class="modal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Save Parameter Set</h3>
            <span class="close-btn">&times;</span>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label for="param-set-name">Name</label>
              <input type="text" id="param-set-name" placeholder="Enter a name for this parameter set">
            </div>
          </div>
          <div class="modal-footer">
            <button id="cancel-save-param-set" class="secondary">Cancel</button>
            <button id="confirm-save-param-set" class="primary">Save</button>
          </div>
        </div>
      </div>
      
      <div id="load-param-set-modal" class="modal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Load Parameter Set</h3>
            <span class="close-btn">&times;</span>
          </div>
          <div class="modal-body">
            <div id="param-sets-selector"></div>
          </div>
          <div class="modal-footer">
            <button id="cancel-load-param-set" class="secondary">Close</button>
          </div>
        </div>
      </div>
      
      <div id="notifications-container"></div>
    </body>
    </html>
  `, { url: 'http://localhost' });

  // Simular o objeto acquireVsCodeApi
  dom.window.acquireVsCodeApi = function() {
    return {
      postMessage: jest.fn()
    };
  };

  // Navigator clipboard API
  dom.window.navigator.clipboard = {
    writeText: jest.fn().mockResolvedValue(undefined)
  };

  // Expor objetos globais para testes
  global.window = dom.window;
  global.document = dom.window.document;
  global.acquireVsCodeApi = dom.window.acquireVsCodeApi;
  global.navigator = dom.window.navigator;

  return dom;
}

// Define as funções para teste diretamente
global.detectQueryParams = function(query) {
  if (!query) return [];
  
  // Primeiro tratamos do caso de strings literais para evitar falsos positivos
  let processedQuery = query;
  const stringLiterals = [];
  
  // Captura strings com aspas simples (mais comum em SQL)
  const singleQuoteRegex = /'([^'\\]|\\.)*'/g;
  processedQuery = processedQuery.replace(singleQuoteRegex, (match) => {
      stringLiterals.push(match);
      return `__STRING_LITERAL_${stringLiterals.length - 1}__`;
  });
  
  // Captura strings com aspas duplas
  const doubleQuoteRegex = /"([^"\\]|\\.)*"/g;
  processedQuery = processedQuery.replace(doubleQuoteRegex, (match) => {
      stringLiterals.push(match);
      return `__STRING_LITERAL_${stringLiterals.length - 1}__`;
  });
  
  // Regex melhorada para capturar três tipos de parâmetros
  const paramRegex = /(?::([a-zA-Z][a-zA-Z0-9_]*))|(?:\?([0-9]+))|(\?)(?![0-9])/g;
  const params = [];
  let placeholderCount = 0;
  let match;
  
  while ((match = paramRegex.exec(processedQuery)) !== null) {
      if (match[1]) {
          // Parâmetro nomeado (:nome)
          if (!params.includes(match[1])) {
              params.push(match[1]);
          }
      } else if (match[2]) {
          // Parâmetro posicional numerado (?1)
          if (!params.includes(match[2])) {
              params.push(match[2]);
          }
      } else if (match[3]) {
          // Parâmetro ? simples (SQL nativo)
          placeholderCount++;
          params.push(`param${placeholderCount}`);
      }
  }
  
  return params;
};

global.detectQueryType = function(query) {
  if (!query) return { isNative: false, confidence: 0 };
  
  let nativeScore = 0;
  let jpqlScore = 0;
  
  // Indicadores de SQL Nativo
  const nativeIndicators = [
      { pattern: /SELECT\s+.*\s+FROM\s+[a-z0-9_]+(\s+[a-z0-9_]+)?/i, weight: 3 },
      { pattern: /\bINSERT\s+INTO\s+[a-z0-9_]+/i, weight: 5 },
      { pattern: /\bUPDATE\s+[a-z0-9_]+\s+SET\b/i, weight: 5 },
      { pattern: /\bDELETE\s+FROM\s+[a-z0-9_]+/i, weight: 5 },
      { pattern: /\bCREATE\s+TABLE\b/i, weight: 5 },
      { pattern: /\bALTER\s+TABLE\b/i, weight: 5 },
      { pattern: /\bDROP\s+TABLE\b/i, weight: 5 },
      { pattern: /\bJOIN\s+[a-z0-9_]+(\s+[a-z0-9_]+)?/i, weight: 2 },
      { pattern: /\bGROUP\s+BY\s+[a-z0-9_]+\.[a-z0-9_]+/i, weight: 2 },
      { pattern: /\bORDER\s+BY\s+[a-z0-9_]+\.[a-z0-9_]+/i, weight: 2 },
      { pattern: /\b[a-z0-9_]+\.[a-z0-9_]+\b/i, weight: 1 }
  ];
  
  // Indicadores de JPQL
  const jpqlIndicators = [
      { pattern: /\bFROM\s+[A-Z][a-zA-Z0-9]*(\s+[a-z])?/i, weight: 3 },
      { pattern: /\bSELECT\s+[a-z]\s+FROM\s+[A-Z]/i, weight: 4 },
      { pattern: /\b[a-z]\.[a-zA-Z0-9]+\.[a-zA-Z0-9]+\b/i, weight: 2 },
      { pattern: /\bJOIN\s+[a-z]\.[a-zA-Z0-9]+\b/i, weight: 3 },
      { pattern: /\bJOIN\s+FETCH\b/i, weight: 5 },
      { pattern: /\bNEW\s+[a-zA-Z0-9_.]+\(/i, weight: 5 },
      { pattern: /\bTYPE\s*\(\s*[a-z]\s*\)\s*[=!<>]/i, weight: 5 },
      { pattern: /\bMEMBER\s+OF\b/i, weight: 5 },
      { pattern: /\bIS\s+EMPTY\b/i, weight: 5 }
  ];
  
  // Avaliar indicadores de SQL Nativo
  for (const indicator of nativeIndicators) {
      if (indicator.pattern.test(query)) {
          nativeScore += indicator.weight;
      }
  }
  
  // Avaliar indicadores de JPQL
  for (const indicator of jpqlIndicators) {
      if (indicator.pattern.test(query)) {
          jpqlScore += indicator.weight;
      }
  }

  // Pontuação adicional baseada no tipo de parâmetros
  const namedParamMatches = (query.match(/:[a-zA-Z][a-zA-Z0-9_]*/g) || []).length;
  const positionalParamMatches = (query.match(/\?[0-9]+/g) || []).length;
  const simplePlaceholderMatches = (query.match(/\?(?![0-9])/g) || []).length;
  
  jpqlScore += (namedParamMatches * 2) + (positionalParamMatches * 2);
  nativeScore += simplePlaceholderMatches * 2;
  
  // Calcular confiança e determinar o tipo
  const totalScore = nativeScore + jpqlScore;
  const nativeConfidence = totalScore > 0 ? nativeScore / totalScore : 0;
  
  return {
      isNative: nativeScore > jpqlScore,
      confidence: nativeConfidence
  };
};

global.prettifyQuery = function(query) {
  if (!query) return '';
  
  // Remover espaços extras e normalizar quebras de linha
  let formatted = query.trim().replace(/\s+/g, ' ');
  
  // Lista de palavras-chave SQL para formatação
  const mainKeywords = [
      'SELECT', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 
      'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 
      'LIMIT', 'OFFSET', 'UNION', 'UNION ALL', 
      'INTERSECT', 'EXCEPT', 'VALUES', 'SET'
  ];
  
  const joinKeywords = [
      'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 
      'FULL JOIN', 'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 
      'FULL OUTER JOIN', 'CROSS JOIN', 'NATURAL JOIN',
      'JOIN FETCH'
  ];
  
  const conditionalKeywords = [
      'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'CASE', 
      'WHEN', 'THEN', 'ELSE', 'END', 'IS NULL', 
      'IS NOT NULL', 'LIKE', 'BETWEEN'
  ];
  
  // Aplicar formatação básica
  mainKeywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      formatted = formatted.replace(regex, `\n${keyword.toUpperCase()}`);
  });
  
  joinKeywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
      formatted = formatted.replace(regex, `\n  ${keyword.toUpperCase()}`);
  });
  
  conditionalKeywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
      formatted = formatted.replace(regex, `\n    ${keyword.toUpperCase()}`);
  });
  
  // Adicionar quebras de linha após vírgulas em listas
  formatted = formatted.replace(/,\s*/g, ',\n    ');
  
  // Remover linhas vazias extras
  formatted = formatted.replace(/\n\s*\n/g, '\n');
  
  return formatted;
};

global.validateQuery = function(query) {
  const issues = [];
  
  if (!query.trim()) {
      issues.push({ severity: 'error', message: 'Query is empty' });
      return issues;
  }
  
  // Verificar por problemas comuns
  
  // SELECT sem FROM
  if (/\bSELECT\b/i.test(query) && !/\bFROM\b/i.test(query)) {
      issues.push({ 
          severity: 'error', 
          message: 'SELECT statement without FROM clause' 
      });
  }
  
  // WHERE sem condição
  if (/\bWHERE\s*(?:\n|\r|$|\bORDER\b|\bGROUP\b)/i.test(query)) {
      issues.push({ 
          severity: 'error', 
          message: 'WHERE clause without conditions' 
      });
  }
  
  // Parênteses não balanceados
  const openParens = (query.match(/\(/g) || []).length;
  const closeParens = (query.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
      issues.push({ 
          severity: 'error', 
          message: `Unbalanced parentheses: ${openParens} opening and ${closeParens} closing` 
      });
  }
  
  // Aspas não balanceadas
  const singleQuotes = (query.match(/'/g) || []).length;
  if (singleQuotes % 2 !== 0) {
      issues.push({ 
          severity: 'error', 
          message: 'Unbalanced single quotes' 
      });
  }
  
  const doubleQuotes = (query.match(/"/g) || []).length;
  if (doubleQuotes % 2 !== 0) {
      issues.push({ 
          severity: 'error', 
          message: 'Unbalanced double quotes' 
      });
  }
  
  // JOIN sem ON/USING
  if (/\bJOIN\b.*?\b(?!ON|USING|FETCH)\b[A-Za-z0-9_]+\s*(?:\n|\r|$|\bWHERE\b)/i.test(query)) {
      issues.push({ 
          severity: 'warning', 
          message: 'JOIN without ON or USING clause' 
      });
  }
  
  // Usar * em consultas de produção
  if (/SELECT\s+\*/i.test(query)) {
      issues.push({ 
          severity: 'info', 
          message: 'Using SELECT * may return unnecessary columns' 
      });
  }
  
  return issues;
};

// Load a simplified version of main.js for testing
function createMockMainJS() {
  const script = document.createElement('script');
  script.textContent = `
    // Mock da função detectQueryParams
    window.detectQueryParams = ${global.detectQueryParams.toString()};
    window.detectQueryType = ${global.detectQueryType.toString()};
    window.prettifyQuery = ${global.prettifyQuery.toString()};
    window.validateQuery = ${global.validateQuery.toString()};

    // Função auxiliar para adicionar campos de parâmetros
    window.addParamField = function(name, value) {
        const container = document.getElementById('params-container');
        const paramItem = document.createElement('div');
        paramItem.className = 'param-item';
        
        paramItem.innerHTML = \`
            <input type="text" class="param-name" placeholder="Name" value="\${name}">
            <input type="text" class="param-value" placeholder="Value" value="\${value}">
            <button class="small secondary remove-param-btn">X</button>
        \`;
        
        container.appendChild(paramItem);
        
        paramItem.querySelector('.remove-param-btn').addEventListener('click', () => {
            paramItem.remove();
        });
    };

    // Função auxiliar para atualizar a UI de parâmetros
    window.updateParamsUI = function() {
        const container = document.getElementById('params-container');
        container.innerHTML = '';
        
        // Add fields for detected parameters
        window.autoDetectedParams.forEach(param => {
            window.addParamField(param, '');
        });
    };

    // Função para exibir notificações
    window.showNotification = function(message, type = 'info', duration = 5000) {
        console.log(\`Notification [\${type}]: \${message}\`);
    };

    // Variáveis globais
    window.autoDetectedParams = [];

    // Mock do VSCode API
    window.vscode = acquireVsCodeApi();
  `;

  document.body.appendChild(script);
}

describe('main.js Enhanced Functions', () => {
  let dom;
  let vscode;

  beforeEach(() => {
    // Configurar o ambiente JSDOM antes de cada teste
    dom = setupJsdom();
    
    // Carregar o mock do main.js
    createMockMainJS();
    
    // Obter a instância mockada do VSCode API
    vscode = dom.window.acquireVsCodeApi();
  });

  describe('detectQueryParams (Enhanced)', () => {
    test('should detect named parameters (JPQL style)', () => {
      const query = 'SELECT e FROM Employee e WHERE e.department.name = :deptName AND e.salary > :minSalary';
      const params = window.detectQueryParams(query);
      
      expect(params).toContain('deptName');
      expect(params).toContain('minSalary');
      expect(params.length).toBe(2);
    });
    
    test('should detect positional parameters with numbers (JPQL style)', () => {
      const query = 'SELECT u FROM User u WHERE u.email = ?1 AND u.active = ?2';
      const params = window.detectQueryParams(query);
      
      expect(params).toContain('1');
      expect(params).toContain('2');
      expect(params.length).toBe(2);
    });
    
    test('should detect simple question mark parameters (native SQL style)', () => {
      const query = 'SELECT * FROM produtos WHERE preco > ? AND ativo = ?';
      const params = window.detectQueryParams(query);
      
      expect(params).toContain('param1');
      expect(params).toContain('param2');
      expect(params.length).toBe(2);
    });
    
    test('should detect mixed parameter styles', () => {
      const query = 'SELECT u.name FROM User u JOIN u.roles r WHERE u.id = ?1 AND r.name = :roleName AND u.active = ?';
      const params = window.detectQueryParams(query);
      
      expect(params).toContain('1');
      expect(params).toContain('roleName');
      expect(params).toContain('param1');
      expect(params.length).toBe(3);
    });
    
    test('should not detect question marks inside string literals', () => {
      const query = "SELECT * FROM users WHERE name LIKE '%?%' AND active = ?";
      const params = window.detectQueryParams(query);
      
      // A função aprimorada deve ignorar o ? dentro da string
      expect(params.length).toBe(1);
      expect(params[0]).toBe('param1');
    });

    test('should handle complex nested queries with parameters', () => {
      const query = `
        SELECT u.name, 
          (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = :status) as order_count,
          (SELECT SUM(o.total) FROM orders o WHERE o.user_id = u.id AND o.created_at > ?) as total_revenue
        FROM users u
        WHERE u.active = ?1 AND u.created_at BETWEEN ? AND ?
      `;
      
      const params = window.detectQueryParams(query);
      
      expect(params).toContain('status');
      expect(params).toContain('1');
      expect(params).toContain('param1');
      expect(params).toContain('param2');
      expect(params).toContain('param3');
      expect(params.length).toBe(5);
    });
  });

  describe('detectQueryType', () => {
    test('should identify SQL query with high confidence', () => {
      const query = 'SELECT id, name FROM users WHERE active = 1 ORDER BY name';
      const result = window.detectQueryType(query);
      
      expect(result.isNative).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
    });
    
    test('should identify JPQL query with high confidence', () => {
      const query = 'SELECT e FROM Employee e JOIN e.department d WHERE d.name = :deptName';
      const result = window.detectQueryType(query);
      
      expect(result.isNative).toBe(false);
      expect(result.confidence).toBeLessThan(0.3); // Low native confidence means high JPQL confidence
    });
    
    test('should identify SQL query based on table.column notation', () => {
      const query = 'SELECT u.name, u.email FROM users u JOIN orders o ON u.id = o.user_id';
      const result = window.detectQueryType(query);
      
      expect(result.isNative).toBe(true);
    });
    
    test('should identify JPQL query based on entity notation', () => {
      const query = 'SELECT u FROM User u WHERE u.department.name = :deptName';
      const result = window.detectQueryType(query);
      
      expect(result.isNative).toBe(false);
    });
    
    test('should identify SQL DDL statements as native', () => {
      const queries = [
        'CREATE TABLE users (id INT, name VARCHAR(50))',
        'ALTER TABLE users ADD COLUMN email VARCHAR(100)',
        'DROP TABLE users',
        'INSERT INTO users VALUES (1, "John")',
        'UPDATE users SET name = "John" WHERE id = 1',
        'DELETE FROM users WHERE id = 1'
      ];
      
      queries.forEach(query => {
        const result = window.detectQueryType(query);
        expect(result.isNative).toBe(true);
        expect(result.confidence).toBeGreaterThan(0.8);
      });
    });
    
    test('should identify JPQL specific features', () => {
      const queries = [
        'SELECT e FROM Employee e JOIN FETCH e.department',
        'SELECT e FROM Employee e WHERE :manager MEMBER OF e.managers',
        'SELECT e FROM Employee e WHERE e.subordinates IS EMPTY',
        'SELECT NEW com.example.EmployeeDTO(e.id, e.name) FROM Employee e'
      ];
      
      queries.forEach(query => {
        const result = window.detectQueryType(query);
        expect(result.isNative).toBe(false);
        expect(result.confidence).toBeLessThan(0.2);
      });
    });
    
    test('should consider parameter style in detection', () => {
      // Native SQL with ? placeholders
      const sqlQuery = 'SELECT * FROM users WHERE id = ? AND active = ?';
      const sqlResult = window.detectQueryType(sqlQuery);
      expect(sqlResult.isNative).toBe(true);
      
      // JPQL with :named parameters
      const jpqlNamedQuery = 'SELECT u FROM User u WHERE u.id = :id AND u.active = :active';
      const jpqlNamedResult = window.detectQueryType(jpqlNamedQuery);
      expect(jpqlNamedResult.isNative).toBe(false);
      
      // JPQL with ?n parameters
      const jpqlPositionalQuery = 'SELECT u FROM User u WHERE u.id = ?1 AND u.active = ?2';
      const jpqlPositionalResult = window.detectQueryType(jpqlPositionalQuery);
      expect(jpqlPositionalResult.isNative).toBe(false);
    });
  });

  describe('prettifyQuery', () => {
    test('should format a simple SELECT query', () => {
      const query = 'SELECT id, name, email FROM users WHERE active = 1';
      const formatted = window.prettifyQuery(query);
      
      expect(formatted).toContain('SELECT');
      expect(formatted).toContain('FROM');
      expect(formatted).toContain('WHERE');
      expect(formatted.split('\n').length).toBeGreaterThan(1);
    });
    
    test('should format keywords to uppercase', () => {
      const query = 'select id from users where active = 1';
      const formatted = window.prettifyQuery(query);
      
      expect(formatted).toContain('SELECT');
      expect(formatted).toContain('FROM');
      expect(formatted).toContain('WHERE');
    });
    
    test('should format JOIN clauses with indentation', () => {
      const query = 'SELECT u.id, u.name FROM users u JOIN orders o ON u.id = o.user_id WHERE o.status = "completed"';
      const formatted = window.prettifyQuery(query);
      
      const lines = formatted.split('\n');
      
      // Verificar se as linhas existem e têm a indentação correta
      const joinLine = lines.find(line => line.trim().startsWith('JOIN'));
      expect(joinLine).toBeDefined();
      expect(joinLine).toMatch(/^\s+JOIN/); // Deve ter espaço no início
    });
    
    test('should format AND/OR conditions with indentation', () => {
      const query = 'SELECT * FROM users WHERE active = 1 AND (role = "admin" OR role = "manager")';
      const formatted = window.prettifyQuery(query);
      
      const lines = formatted.split('\n');
      
      // Verificar se as linhas existem e têm a indentação correta
      const andLine = lines.find(line => line.trim().startsWith('AND'));
      const orLine = lines.find(line => line.trim().startsWith('OR'));
      
      expect(andLine).toBeDefined();
      expect(orLine).toBeDefined();
      
      expect(andLine).toMatch(/^\s+AND/); // Deve ter espaço no início
      expect(orLine).toMatch(/^\s+OR/); // Deve ter mais espaço no início
    });
    
    test('should format lists with commas on new lines', () => {
      const query = 'SELECT id, name, email, phone, address FROM users';
      const formatted = window.prettifyQuery(query);
      
      const lines = formatted.split('\n');
      expect(lines.length).toBeGreaterThan(1);
      
      // Deve haver uma linha para cada item da lista após o primeiro
      expect(lines.some(line => line.includes('name'))).toBeTruthy();
      expect(lines.some(line => line.includes('email'))).toBeTruthy();
      expect(lines.some(line => line.includes('phone'))).toBeTruthy();
      expect(lines.some(line => line.includes('address'))).toBeTruthy();
    });
    
    test('should format complex queries with multiple clauses', () => {
      const query = `
        SELECT u.id, u.name, COUNT(o.id) as order_count 
        FROM users u 
        LEFT JOIN orders o ON u.id = o.user_id 
        WHERE u.active = 1 AND u.created_at > '2023-01-01' 
        GROUP BY u.id, u.name 
        HAVING COUNT(o.id) > 0 
        ORDER BY order_count DESC, u.name ASC 
        LIMIT 10
      `;
      
      const formatted = window.prettifyQuery(query);
      
      // Verificar se todas as cláusulas estão presentes e formatadas
      expect(formatted).toContain('SELECT');
      expect(formatted).toContain('FROM');
      expect(formatted).toContain('LEFT JOIN');
      expect(formatted).toContain('WHERE');
      expect(formatted).toContain('GROUP BY');
      expect(formatted).toContain('HAVING');
      expect(formatted).toContain('ORDER BY');
      expect(formatted).toContain('LIMIT');
      
      // Verificar estrutura geral
      const lines = formatted.split('\n');
      expect(lines.length).toBeGreaterThan(7);
    });
  });

  describe('validateQuery', () => {
    test('should detect when query is empty', () => {
      const issues = window.validateQuery('');
      
      expect(issues.length).toBe(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('empty');
    });
    
    test('should detect SELECT without FROM', () => {
      const query = 'SELECT id, name';
      const issues = window.validateQuery(query);
      
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.message.includes('FROM') && i.severity === 'error')).toBeTruthy();
    });
    
    test('should detect WHERE without conditions', () => {
      const query = 'SELECT * FROM users WHERE';
      const issues = window.validateQuery(query);
      
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.message.includes('WHERE') && i.severity === 'error')).toBeTruthy();
    });
    
    test('should detect unbalanced parentheses', () => {
      const query = 'SELECT * FROM users WHERE (active = 1 AND (role = "admin"';
      const issues = window.validateQuery(query);
      
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.message.includes('parentheses') && i.severity === 'error')).toBeTruthy();
    });
    
    test('should detect unbalanced quotes', () => {
      const queries = [
        'SELECT * FROM users WHERE name = \'John',
        'SELECT * FROM users WHERE name = "John'
      ];
      
      queries.forEach(query => {
        const issues = window.validateQuery(query);
        expect(issues.length).toBeGreaterThan(0);
        expect(issues.some(i => i.message.includes('quotes') && i.severity === 'error')).toBeTruthy();
      });
    });
    
    test('should detect JOIN without ON/USING', () => {
      const query = 'SELECT u.id, o.id FROM users u JOIN orders o WHERE u.id = 1';
      const issues = window.validateQuery(query);
      
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.message.includes('JOIN without ON') && i.severity === 'warning')).toBeTruthy();
    });
    
    test('should warn about SELECT *', () => {
      const query = 'SELECT * FROM users';
      const issues = window.validateQuery(query);
      
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.message.includes('SELECT *') && i.severity === 'info')).toBeTruthy();
    });
    
    test('should validate complex queries with no issues', () => {
      const query = `
        SELECT u.id, u.name, COUNT(o.id) as order_count 
        FROM users u 
        LEFT JOIN orders o ON u.id = o.user_id 
        WHERE u.active = 1 AND u.created_at > '2023-01-01' 
        GROUP BY u.id, u.name 
        HAVING COUNT(o.id) > 0 
        ORDER BY order_count DESC, u.name ASC 
        LIMIT 10
      `;
      
      const issues = window.validateQuery(query);
      
      // Não deve haver erros, apenas talvez warnings ou infos
      expect(issues.filter(i => i.severity === 'error').length).toBe(0);
    });
    
    test('should validate INSERT statements', () => {
      const query = 'INSERT INTO users (id, name) VALUES (1, "John")';
      const issues = window.validateQuery(query);
      
      // Não deve detectar erros em um INSERT válido
      expect(issues.filter(i => i.severity === 'error').length).toBe(0);
    });
    
    test('should validate JPQL queries', () => {
      const query = 'SELECT e FROM Employee e WHERE e.department.name = :deptName';
      const issues = window.validateQuery(query);
      
      // Não deve detectar erros em um JPQL válido
      expect(issues.filter(i => i.severity === 'error').length).toBe(0);
    });
  });
});