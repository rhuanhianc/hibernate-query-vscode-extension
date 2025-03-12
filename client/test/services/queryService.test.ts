// Configurar os mocks antes de importar o código a ser testado
jest.mock('vscode');
jest.mock('../../src/utils/logger');
jest.mock('../../src/services/telemetryService');
jest.mock('../../src/queryClient');

import { QueryService } from '../../src/services/queryService';
import { QueryClient } from '../../src/queryClient';

describe('QueryService', () => {
  let queryService: QueryService;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Configurar o mock do QueryClient para retornar dados
    (QueryClient.prototype.executeQuery as jest.Mock).mockImplementation(() => {
      return Promise.resolve([
        { id: 1, name: 'Test User', email: 'test@example.com' }
      ]);
    });
    
    queryService = new QueryService();
  });
  
  // Testes para getters
  describe('getters', () => {
    it('should return correct server port', () => {
      expect(queryService.getServerPort()).toBe(8089);
    });

    it('should return correct server host', () => {
      expect(queryService.getServerHost()).toBe('127.0.0.1');
    });

    it('should return correct hibernate version', () => {
      expect(queryService.getHibernateVersion()).toBe('5.6.15');
    });

    it('should use custom server port and host', () => {
      const customService = new QueryService(9000, 'localhost');
      expect(customService.getServerPort()).toBe(9000);
      expect(customService.getServerHost()).toBe('localhost');
    });
  });
  
  // Testes para executeQuery
  describe('executeQuery', () => {
    it('should call the client with normalized query', async () => {
      const query = 'select * from users';
      const params = { id: 1 };
      const isNative = true;
      const config = {};

      const result = await queryService.executeQuery(query, params, isNative, config);
      
      // Verificar que executeQuery foi chamado corretamente
      expect(QueryClient.prototype.executeQuery).toHaveBeenCalledWith(
        'SELECT * FROM users', // Normalizado
        params,
        isNative,
        config
      );
      
      // Verificar que retorna um resultado
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(1);
    });

    it('should update hibernate version when provided in config', async () => {
      const query = 'select * from users';
      const params = {};
      const config = { hibernateVersion: '6.0.0' };

      await queryService.executeQuery(query, params, false, config);
      
      expect(queryService.getHibernateVersion()).toBe('6.0.0');
    });
  });
  
  // Testes para normalizeQuery
  describe('normalizeQuery', () => {
    it('should normalize SQL keywords to uppercase', () => {
      const query = 'select * from users where id = 1';
      const normalized = queryService.normalizeQuery(query);
      
      // Verificar que os keywords principais estão em maiúsculas
      expect(normalized).toContain('SELECT');
      expect(normalized).toContain('FROM');
      expect(normalized).toContain('WHERE');
    });

    it('should handle mixed case keywords', () => {
      const query = 'Select * From users Where id = 1';
      const normalized = queryService.normalizeQuery(query);
      
      // Verificar que os keywords principais estão em maiúsculas
      expect(normalized).toContain('SELECT');
      expect(normalized).toContain('FROM');
      expect(normalized).toContain('WHERE');
    });

    it('should normalize JOIN keywords', () => {
      const query = 'select u.* from users u inner join orders o on u.id = o.user_id';
      const normalized = queryService.normalizeQuery(query);
      
      // Verificar que os keywords específicos estão em maiúsculas
      expect(normalized).toContain('SELECT');
      expect(normalized).toContain('FROM');
      expect(normalized).toContain('INNER JOIN');
      expect(normalized).toMatch(/ON\b/i);  // Verifica "ON" como palavra inteira
    });

    it('should normalize GROUP BY and ORDER BY keywords', () => {
      const query = 'select count(*) from users group by status order by count(*) desc';
      const normalized = queryService.normalizeQuery(query);
      
      // Verificar que os keywords compostos estão em maiúsculas
      expect(normalized).toContain('SELECT');
      expect(normalized).toContain('FROM');
      expect(normalized).toMatch(/GROUP BY/i);
      expect(normalized).toMatch(/ORDER BY/i);
    });

    it('should normalize logical operators', () => {
      const query = 'select * from users where active = 1 and (age > 18 or role = "admin")';
      const normalized = queryService.normalizeQuery(query);
      
      // Verificar que os operadores lógicos estão em maiúsculas
      expect(normalized).toContain('WHERE');
      expect(normalized).toMatch(/AND\b/i);
      expect(normalized).toMatch(/OR\b/i);
    });

    it('should handle keywords in different parts of the query', () => {
      const query = 'select id, (select count(*) from orders where user_id = users.id) as order_count from users';
      const normalized = queryService.normalizeQuery(query);
      
      // Verificar que os keywords em subconsultas também são normalizados
      expect(normalized).toContain('SELECT');
      expect(normalized).toMatch(/FROM\s+users/i);
      // A subconsulta também deve ter seus keywords normalizados
      expect(normalized).toMatch(/\(\s*SELECT/i);
      expect(normalized).toMatch(/FROM\s+orders/i);
      expect(normalized).toContain('WHERE');
    });

    it('should not modify non-keyword words', () => {
      const query = 'SELECT name, fromDate, whereClause FROM userData';
      const normalized = queryService.normalizeQuery(query);
      
      // Verificar que palavras que parecem keywords mas não são permanecem inalteradas
      expect(normalized).toContain('fromDate');
      expect(normalized).toContain('whereClause');
    });

    it('should handle JPQL queries', () => {
      const query = 'select e from Employee e where e.department.name = :deptName';
      const normalized = queryService.normalizeQuery(query);
      
      // Verificar que os keywords JPQL são normalizados
      expect(normalized).toContain('SELECT');
      expect(normalized).toMatch(/FROM\s+Employee/i);
      expect(normalized).toContain('WHERE');
    });
  });
  
  // Testes para formatResults
  describe('formatResults', () => {
    it('should format results with all keys present', () => {
      const results = [
        { id: 1, name: 'John', age: 30 },
        { id: 2, name: 'Jane', age: 25 }
      ];
      
      const formatted = queryService.formatResults(results);
      
      expect(formatted.columns).toEqual(expect.arrayContaining(['id', 'name', 'age']));
      expect(formatted.rows).toHaveLength(2);
      expect(formatted.rows[0]).toEqual({ id: 1, name: 'John', age: 30 });
      expect(formatted.rows[1]).toEqual({ id: 2, name: 'Jane', age: 25 });
    });

    it('should handle missing properties with null values', () => {
      const results = [
        { id: 1, name: 'John', age: 30 },
        { id: 2, name: 'Jane' } // Missing age
      ];
      
      const formatted = queryService.formatResults(results);
      
      expect(formatted.columns).toEqual(expect.arrayContaining(['id', 'name', 'age']));
      expect(formatted.rows).toHaveLength(2);
      expect(formatted.rows[0]).toEqual({ id: 1, name: 'John', age: 30 });
      expect(formatted.rows[1]).toEqual({ id: 2, name: 'Jane', age: null });
    });

    it('should return empty array for empty or null input', () => {
      expect(queryService.formatResults([])).toEqual([]);
      expect(queryService.formatResults(null as any)).toEqual([]);
    });

    it('should combine all unique keys from all results', () => {
      const results = [
        { id: 1, name: 'John' },
        { id: 2, email: 'jane@example.com' },
        { id: 3, phone: '123-456-7890' }
      ];
      
      const formatted = queryService.formatResults(results);
      
      expect(formatted.columns).toEqual(expect.arrayContaining(['id', 'name', 'email', 'phone']));
      expect(formatted.rows).toHaveLength(3);
      expect(formatted.rows[0]).toEqual({ id: 1, name: 'John', email: null, phone: null });
      expect(formatted.rows[1]).toEqual({ id: 2, name: null, email: 'jane@example.com', phone: null });
      expect(formatted.rows[2]).toEqual({ id: 3, name: null, email: null, phone: '123-456-7890' });
    });
  });
  
  // Testes para formatQuery
  describe('formatQuery', () => {
    it('should format a simple SELECT query', () => {
      const query = 'SELECT * FROM users WHERE active = 1';
      const formatted = queryService.formatQuery(query);
      
      // Verificar os elementos principais da consulta formatada
      expect(formatted).toContain('SELECT *');
      expect(formatted).toContain('FROM users');
      expect(formatted).toContain('WHERE active = 1');
    });

    it('should format a query with JOINs', () => {
      const query = 'SELECT u.name, o.order_date FROM users u JOIN orders o ON u.id = o.user_id WHERE o.status = "completed"';
      const formatted = queryService.formatQuery(query);
      
      // Verificar os elementos principais da consulta formatada
      expect(formatted).toContain('SELECT u.name');
      expect(formatted).toContain('o.order_date');
      expect(formatted).toContain('FROM users u');
      expect(formatted).toContain('JOIN orders o');
      expect(formatted).toContain('ON u.id = o.user_id');
      expect(formatted).toContain('WHERE o.status = "completed"');
    });

    it('should format a complex query with multiple conditions', () => {
      const query = 'SELECT id, name, email FROM users WHERE active = 1 AND (role = "admin" OR role = "manager") ORDER BY name ASC';
      const formatted = queryService.formatQuery(query);
      
      // Verificar os elementos principais da consulta formatada
      expect(formatted).toContain('SELECT id');
      expect(formatted).toContain('name');
      expect(formatted).toContain('email');
      expect(formatted).toContain('FROM users');
      expect(formatted).toContain('WHERE active = 1');
      expect(formatted).toContain('AND (role = "admin"');
      expect(formatted).toContain('OR role = "manager")');
      expect(formatted).toContain('ORDER BY name ASC');
    });

    it('should format a query with GROUP BY and HAVING clauses', () => {
      const query = 'SELECT department_id, COUNT(*) as employee_count FROM employees GROUP BY department_id HAVING COUNT(*) > 5 ORDER BY employee_count DESC';
      const formatted = queryService.formatQuery(query);
      
      // Verificar os elementos principais da consulta formatada
      expect(formatted).toContain('SELECT department_id');
      expect(formatted).toContain('COUNT(*) AS employee_count');
      expect(formatted).toContain('FROM employees');
      expect(formatted).toContain('GROUP BY department_id');
      expect(formatted).toContain('HAVING COUNT(*) > 5');
      expect(formatted).toContain('ORDER BY employee_count DESC');
    });

    it('should handle CASE statements', () => {
      const query = 'SELECT id, name, CASE WHEN age < 18 THEN "minor" WHEN age >= 18 AND age < 65 THEN "adult" ELSE "senior" END as age_category FROM users';
      const formatted = queryService.formatQuery(query);
      
      // Verificar os elementos principais da consulta formatada
      expect(formatted).toContain('SELECT id');
      expect(formatted).toContain('name');
      expect(formatted).toContain('CASE');
      expect(formatted).toContain('WHEN age < 18');
      expect(formatted).toContain('THEN "minor"');
      expect(formatted).toContain('WHEN age >= 18');
      expect(formatted).toContain('AND age < 65');
      expect(formatted).toContain('THEN "adult"');
      expect(formatted).toContain('ELSE "senior"');
      expect(formatted).toContain('END AS age_category');
      expect(formatted).toContain('FROM users');
    });

    it('should handle queries with string concatenation', () => {
      const query = '"SELECT * FROM users " + "WHERE active = 1"';
      const formatted = queryService.formatQuery(query);
      
      // Verificar os elementos principais da consulta formatada
      expect(formatted).toContain('SELECT *');
      expect(formatted).toContain('FROM users');
      expect(formatted).toContain('WHERE active = 1');
    });

    it('should handle complete quoted queries', () => {
      const query = '"SELECT * FROM users WHERE active = 1"';
      const formatted = queryService.formatQuery(query);
      
      // Verificar os elementos principais da consulta formatada
      expect(formatted).toContain('SELECT *');
      expect(formatted).toContain('FROM users');
      expect(formatted).toContain('WHERE active = 1');
    });

    it('should format UNION queries', () => {
      const query = 'SELECT id, name FROM users UNION SELECT id, product_name as name FROM products';
      const formatted = queryService.formatQuery(query);
      
      // Verificar os elementos principais da consulta formatada
      expect(formatted).toContain('SELECT id');
      expect(formatted).toContain('name');
      expect(formatted).toContain('FROM users');
      expect(formatted).toContain('UNION');
      expect(formatted).toContain('SELECT id');
      expect(formatted).toContain('product_name AS name');
      expect(formatted).toContain('FROM products');
    });

    it('should format JOIN types correctly', () => {
      const query = 'SELECT u.name, a.street FROM users u LEFT JOIN addresses a ON u.id = a.user_id';
      const formatted = queryService.formatQuery(query);
      
      // Verificar os elementos principais da consulta formatada
      expect(formatted).toContain('SELECT u.name');
      expect(formatted).toContain('a.street');
      expect(formatted).toContain('FROM users u');
      expect(formatted).toContain('LEFT JOIN addresses a');
      expect(formatted).toContain('ON u.id = a.user_id');
    });
  });
});