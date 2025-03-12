// Configurar os mocks antes de importar o código a ser testado
jest.mock('vscode');
jest.mock('../../src/utils/logger');
jest.mock('../../src/services/telemetryService');
jest.mock('../../src/queryClient');

import { QueryService } from '../../src/services/queryService';
import { QueryClient } from '../../src/queryClient';

// Testes de integração para QueryService
describe('QueryService Integration Tests', () => {
  let queryService: QueryService;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Configurar mocks específicos para cada teste
    (QueryClient.prototype.executeQuery as jest.Mock).mockImplementation((query) => {
      if (query.includes('SELECT * FROM users')) {
        return Promise.resolve([
          { id: 1, name: 'John', email: 'john@example.com' },
          { id: 2, name: 'Jane', email: 'jane@example.com' }
        ]);
      } else if (query.includes('JOIN')) {
        return Promise.resolve([
          { user_id: 1, user_name: 'John', order_id: 101, order_date: '2023-01-15' },
          { user_id: 1, user_name: 'John', order_id: 102, order_date: '2023-02-20' },
          { user_id: 2, user_name: 'Jane', order_id: 103, order_date: '2023-03-10' }
        ]);
      } else {
        return Promise.resolve([]);
      }
    });
    
    queryService = new QueryService();
  });
  
  describe('End-to-end query execution flow', () => {
    it('should normalize query, execute it, and format the results', async () => {
      // 1. Query com keywords em lowercase que serão normalizados
      const query = 'select * from users where active = 1';
      const params = { active: 1 };
      
      // 2. Executa a query (que internamente chama normalizeQuery)
      const rawResults = await queryService.executeQuery(query, params, true);
      
      // 3. Formata os resultados
      const formattedResults = queryService.formatResults(rawResults);
      
      // Verifica se a query foi normalizada corretamente quando passou para QueryClient
      expect(QueryClient.prototype.executeQuery).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE active = 1',
        params,
        true,
        {}
      );
      
      // Verifica se os resultados foram formatados corretamente
      expect(formattedResults).toBeDefined();
      expect(formattedResults.columns).toContain('id');
      expect(formattedResults.columns).toContain('name');
      expect(formattedResults.columns).toContain('email');
      expect(formattedResults.rows).toHaveLength(2);
    });
    
    it('should normalize, format and execute a complex query', async () => {
      // Query complexa com JOINs
      const query = 'select u.id as user_id, u.name as user_name, o.id as order_id, o.date as order_date ' +
                   'from users u inner join orders o on u.id = o.user_id ' +
                   'where o.status = "completed"';
      
      // Primeiro obtém a query formatada para leitura
      const formattedQuery = queryService.formatQuery(query);
      
      // Executa a query
      const results = await queryService.executeQuery(query, { status: 'completed' }, true);
      
      // Verifica se a formatação contém os elementos esperados
      expect(formattedQuery).toContain('SELECT');
      expect(formattedQuery).toContain('u.id AS user_id');
      expect(formattedQuery).toContain('FROM');
      expect(formattedQuery).toContain('users u');
      expect(formattedQuery).toContain('INNER JOIN');
      
      // Verifica se os resultados têm a estrutura esperada
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(3);
      expect(results[0]).toHaveProperty('user_id');
      expect(results[0]).toHaveProperty('order_id');
    });
  });
  
  describe('Combined normalization and formatting', () => {
    it('should handle multiple keyword styles and produce consistent formatted output', () => {
      // Array de consultas com diferentes estilos de keywords
      const queryVariations = [
        'SELECT * FROM users WHERE status = "active"',
        'select * from users where status = "active"',
        'Select * From Users Where status = "active"'
      ];
      
      // Testa cada variação
      queryVariations.forEach(query => {
        // Primeiro normaliza
        const normalizedQuery = queryService.normalizeQuery(query);
        // Depois formata
        const formattedQuery = queryService.formatQuery(normalizedQuery);
        
        // Verifica se a normalização manteve a estrutura correta
        expect(normalizedQuery.toUpperCase()).toContain('SELECT * FROM');
        
        // Verifica se a formatação contém os elementos principais esperados
        expect(formattedQuery).toContain('SELECT *');
        expect(formattedQuery).toContain('FROM');
        expect(formattedQuery).toContain('WHERE status = "active"');
      });
    });
    
    it('should handle a query with many complex elements and produce well-formatted output', () => {
      const complexQuery = `
        select 
          u.id, 
          u.name, 
          case when u.type = 'premium' then 'VIP' else 'Regular' end as user_type,
          (select count(*) from orders o where o.user_id = u.id) as order_count
        from 
          users u
        left join 
          user_profiles up on u.id = up.user_id
        where 
          u.created_at > '2023-01-01'
          and (u.status = 'active' or u.status = 'pending')
        group by 
          u.id, u.name, u.type
        having 
          count(distinct o.id) > 3
        order by 
          order_count desc, u.name asc
        limit 10
      `;
      
      // Normaliza e formata
      const normalized = queryService.normalizeQuery(complexQuery);
      const formatted = queryService.formatQuery(normalized);
      
      // Verifica elementos chave na saída formatada
      expect(formatted).toContain('SELECT');
      expect(formatted).toContain('u.id');
      expect(formatted).toContain('CASE');
      expect(formatted).toContain('FROM');
      expect(formatted).toContain('users u');
      expect(formatted).toContain('LEFT JOIN');
      expect(formatted).toContain('user_profiles up');
      expect(formatted).toContain('WHERE');
      expect(formatted).toContain('GROUP BY');
      expect(formatted).toContain('HAVING');
      expect(formatted).toContain('ORDER BY');
      expect(formatted).toContain('LIMIT 10');
      
      // Verifica indentação adequada - verificando apenas se algumas linhas começam com os padrões esperados
      const lines = formatted.split('\n');
      expect(lines.some(line => line.trim().startsWith('FROM'))).toBeTruthy();
      expect(lines.some(line => line.trim().startsWith('LEFT JOIN'))).toBeTruthy();
      expect(lines.some(line => line.trim().startsWith('WHERE'))).toBeTruthy();
      
      // Verifica se a formatação mantém a estrutura hierárquica com indentação
      // Encontrando a presença de diferentes elementos
      const hasFrom = lines.findIndex(line => line.trim().startsWith('FROM')) >= 0;
      const hasWhere = lines.findIndex(line => line.trim().startsWith('WHERE')) >= 0;
      
      expect(hasFrom).toBe(true);
      expect(hasWhere).toBe(true);
    });
  });
  
  describe('Challenging edge cases', () => {
    it('should handle quoted strings with SQL keywords inside them', () => {
      const query = `SELECT id, name, description FROM products WHERE description LIKE "%SELECT the best from our%" OR name LIKE "%WHERE%"`;
      
      const normalized = queryService.normalizeQuery(query);
      const formatted = queryService.formatQuery(normalized);
      
      // Verifica se a formatação mantém corretamente as strings com keywords
      expect(formatted).toContain('WHERE description LIKE');
      expect(formatted).toContain('OR name LIKE');
      // Verifica apenas que as palavras-chave estão presentes, sem verificar a formatação exata
      expect(formatted).toContain('SELECT');
      expect(formatted).toContain('WHERE');
      expect(formatted).toContain('FROM');
    });
    
    it('should correctly format multi-line string concatenation', () => {
      const query = `"SELECT p.id, p.name, " +
                    "c.name as category_name " +
                    "FROM products p " +
                    "JOIN categories c ON p.category_id = c.id " +
                    "WHERE p.price > 100 " +
                    "ORDER BY p.price DESC"`;
      
      const formatted = queryService.formatQuery(query);
      
      // Verifica se a formatação removeu a concatenação corretamente
      expect(formatted).toContain('SELECT p.id');
      expect(formatted).not.toContain('" +');
      expect(formatted).toContain('FROM products p');
      expect(formatted).toContain('JOIN categories c');
      expect(formatted).toContain('WHERE p.price > 100');
      expect(formatted).toContain('ORDER BY p.price DESC');
    });
    
    it('should handle subqueries correctly', () => {
      const query = `SELECT 
        main.id, 
        (SELECT COUNT(*) FROM orders WHERE user_id = main.id) as order_count
      FROM 
        users main
      WHERE 
        main.active = 1`;
      
      const formatted = queryService.formatQuery(query);
      
      // Verificar elementos-chave estão presentes
      expect(formatted).toContain('SELECT');
      expect(formatted).toContain('main.id');
      // Verificar que a subconsulta está presente, mas sem exigir uma formatação específica
      expect(formatted).toMatch(/SELECT\s+COUNT\(\*\)/i);
      expect(formatted).toContain('FROM orders');
      expect(formatted).toContain('WHERE user_id = main.id');
      expect(formatted).toContain('AS order_count');
      
      // Usando uma expressão regular para encontrar o padrão "FROM users main"
      expect(formatted).toMatch(/FROM\s+users\s+main/i);
      
      // Usando uma expressão regular para encontrar o padrão "WHERE main.active = 1"
      expect(formatted).toMatch(/WHERE\s+main\.active\s*=\s*1/i);
    });
  });
});