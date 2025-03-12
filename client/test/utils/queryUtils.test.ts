import { QueryUtils } from '../../src/utils/queryUtils';
import { QueryInfo } from '../../src/utils/types';

describe('QueryUtils', () => {
  let queryUtils: QueryUtils;

  beforeEach(() => {
    queryUtils = new QueryUtils();
  });

  describe('scanQueries', () => {
    it('should find SQL string declarations', () => {
      const text = `
        String sql = "SELECT * FROM users WHERE id = 1";
        String sqlQuery = "SELECT name, email FROM customers";
      `;
      
      const result = queryUtils.scanQueries(text);
      
      expect(result.length).toBe(2);
      expect(result[0].query).toBe('SELECT * FROM users WHERE id = 1');
      expect(result[0].isNative).toBe(true);
      expect(result[1].query).toBe('SELECT name, email FROM customers');
      expect(result[1].isNative).toBe(true);
    });

    it('should find JPQL string declarations', () => {
      const text = `
        String jpql = "SELECT e FROM Employee e WHERE e.department.name = 'IT'";
        String hql = "FROM Product p WHERE p.category.id = :categoryId";
      `;
      
      const result = queryUtils.scanQueries(text);
      
      expect(result.length).toBe(2);
      expect(result[0].query).toBe("SELECT e FROM Employee e WHERE e.department.name = 'IT'");
      expect(result[0].isNative).toBe(false);
      expect(result[1].query).toBe("FROM Product p WHERE p.category.id = :categoryId");
      expect(result[1].isNative).toBe(false);
    });

    it('should find createQuery method calls', () => {
      const text = `
        entityManager.createQuery("SELECT c FROM Customer c WHERE c.status = :status");
        entityManager.createNativeQuery("SELECT * FROM orders WHERE created_date > SYSDATE - 30");
      `;
      
      const result = queryUtils.scanQueries(text);
      
      expect(result.length).toBe(2);
      expect(result[0].query).toBe("SELECT c FROM Customer c WHERE c.status = :status");
      expect(result[0].isNative).toBe(false);
      expect(result[1].query).toBe("SELECT * FROM orders WHERE created_date > SYSDATE - 30");
      expect(result[1].isNative).toBe(true);
    });

    it('should find JPA annotations', () => {
      const text = `
        @Query("SELECT u FROM User u WHERE u.email = ?1")
        public User findByEmail(String email);
        
        @Query(value = "SELECT * FROM product WHERE price < ?1", nativeQuery = true)
        public List<Product> findCheaperThan(BigDecimal price);
        
        @NamedQuery(name = "User.findByUsername", query = "SELECT u FROM User u WHERE u.username = :username")
        public class User { }
      `;
      
      const result = queryUtils.scanQueries(text);
      
      expect(result.length).toBe(3);
      expect(result[0].query).toBe("SELECT u FROM User u WHERE u.email = ?1");
      expect(result[0].isNative).toBe(false);
      expect(result[1].query).toBe("SELECT * FROM product WHERE price < ?1");
      expect(result[1].isNative).toBe(true);
      expect(result[2].query).toBe("SELECT u FROM User u WHERE u.username = :username");
      expect(result[2].isNative).toBe(false);
    });

    it('should handle string concatenation in queries', () => {
      const text = `
        String sql = "SELECT * FROM users " +
                    "WHERE active = true " +
                    "ORDER BY name";
      `;
      
      const result = queryUtils.scanQueries(text);
      
      expect(result.length).toBe(1);
      expect(result[0].query).toBe("SELECT * FROM users WHERE active = true ORDER BY name");
      expect(result[0].isNative).toBe(true);
    });

    it('should not add duplicate queries', () => {
      const text = `
        String sql1 = "SELECT * FROM users";
        String sql2 = "SELECT * FROM users";
      `;
      
      const result = queryUtils.scanQueries(text);
      
      expect(result.length).toBe(1);
      expect(result[0].query).toBe("SELECT * FROM users");
    });
  });

  describe('extractQueryFromContent', () => {
    it('should extract simple query from quoted content', () => {
      const content = '"SELECT * FROM users"';
      const result = queryUtils.extractQueryFromContent(content, true);
      
      expect(result.query).toBe('SELECT * FROM users');
      expect(result.isNative).toBe(true);
    });

    it('should extract query from content with string concatenation', () => {
      const content = '"SELECT * FROM users " + "WHERE id = 1"';
      const result = queryUtils.extractQueryFromContent(content, true);
      
      expect(result.query).toBe('SELECT * FROM users WHERE id = 1');
      expect(result.isNative).toBe(true);
    });

    it('should handle complex string concatenation', () => {
      const content = '"SELECT u.name, " + "u.email, " + "u.last_login FROM users u"';
      const result = queryUtils.extractQueryFromContent(content, true);
      
      expect(result.query).toBe('SELECT u.name, u.email, u.last_login FROM users u');
      expect(result.isNative).toBe(true);
    });

    it('should handle different quote styles', () => {
      const content = "'SELECT e FROM Employee e'";
      const result = queryUtils.extractQueryFromContent(content, false);
      
      expect(result.query).toBe('SELECT e FROM Employee e');
      expect(result.isNative).toBe(false);
    });

    it('should return empty query for invalid content', () => {
      const content = 'invalidContent';
      const result = queryUtils.extractQueryFromContent(content, true);
      
      expect(result.query).toBe('');
      expect(result.isNative).toBe(true);
    });
  });

  describe('processExtractedQuery', () => {
    it('should trim whitespace from the query', () => {
      const query = '  SELECT * FROM users  ';
      const result = queryUtils.processExtractedQuery(query, true);
      
      expect(result).toBe('SELECT * FROM users');
    });

    it('should fix to_char function for native queries', () => {
      const query = "SELECT to_char(created_date, 'YYYY-MM-DD) FROM orders";
      const result = queryUtils.processExtractedQuery(query, true);
      
      expect(result).toBe("SELECT to_char(created_date, 'YYYY-MM-DD') FROM orders");
    });

    it('should fix unclosed quotes in date patterns for YYYY', () => {
      const query = "SELECT to_char(date_field, 'YYYY) FROM table";
      const result = queryUtils.processExtractedQuery(query, true);
      
      expect(result).toBe("SELECT to_char(date_field, 'YYYY') FROM table");
    });

    it('should fix unclosed quotes in date patterns for MM', () => {
      const query = "SELECT to_char(date_field, 'MM) FROM table";
      const result = queryUtils.processExtractedQuery(query, true);
      
      expect(result).toBe("SELECT to_char(date_field, 'MM') FROM table");
    });

    it('should fix unclosed quotes in date patterns for DD', () => {
      const query = "SELECT to_char(date_field, 'DD) FROM table";
      const result = queryUtils.processExtractedQuery(query, true);
      
      expect(result).toBe("SELECT to_char(date_field, 'DD') FROM table");
    });

    it('should not modify JPQL queries', () => {
      const query = "SELECT e FROM Employee e WHERE e.department.name = 'IT'";
      const result = queryUtils.processExtractedQuery(query, false);
      
      expect(result).toBe("SELECT e FROM Employee e WHERE e.department.name = 'IT'");
    });
  });

  describe('determineIfNative', () => {
    it('should identify native SQL by table references', () => {
      const query = 'SELECT u.name, u.email FROM users u WHERE u.active = 1';
      const result = queryUtils.determineIfNative(query);
      
      expect(result).toBe(true);
    });

    it('should identify native SQL with schema references', () => {
      const query = 'SELECT * FROM schema.table WHERE column = 1';
      const result = queryUtils.determineIfNative(query);
      
      expect(result).toBe(true);
    });

    it('should identify native SQL with to_char function', () => {
      const query = "SELECT to_char(created_date, 'YYYY-MM-DD') FROM orders";
      const result = queryUtils.determineIfNative(query);
      
      expect(result).toBe(true);
    });

    it('should identify native SQL with snake case names', () => {
      const query = 'SELECT user_id, first_name FROM user_profiles';
      const result = queryUtils.determineIfNative(query);
      
      expect(result).toBe(true);
    });

    it('should identify JPQL by JOIN FETCH', () => {
      const query = 'SELECT o FROM Order o JOIN FETCH o.items WHERE o.customer.id = :customerId';
      const result = queryUtils.determineIfNative(query);
      
      expect(result).toBe(false);
    });

    it('should identify JPQL by MEMBER OF', () => {
      const query = 'SELECT p FROM Product p WHERE :category MEMBER OF p.categories';
      const result = queryUtils.determineIfNative(query);
      
      expect(result).toBe(false);
    });

    it('should identify JPQL by IS EMPTY', () => {
      const query = 'SELECT c FROM Customer c WHERE c.orders IS EMPTY';
      const result = queryUtils.determineIfNative(query);
      
      expect(result).toBe(false);
    });

    it('should identify JPQL by NEW constructor', () => {
      const query = 'SELECT NEW com.example.UserDTO(u.id, u.name) FROM User u';
      const result = queryUtils.determineIfNative(query);
      
      expect(result).toBe(false);
    });

    it('should identify JPQL by entity names in PascalCase', () => {
      const query = 'SELECT u FROM User u WHERE u.active = true';
      const result = queryUtils.determineIfNative(query);
      
      expect(result).toBe(false);
    });

    it('should identify JPQL by property access with dot notation', () => {
      const query = 'SELECT o FROM Order o WHERE o.customer.address.city = :city';
      const result = queryUtils.determineIfNative(query);
      
      expect(result).toBe(false);
    });
  });

  describe('formatQueryScan', () => {
    it('should normalize whitespace', () => {
      const query = 'SELECT  *  FROM\nusers\tWHERE\r\nid = 1';
      const result = queryUtils.formatQueryScan(query);
      
      expect(result).toBe('SELECT * FROM users WHERE id = 1');
    });

    it('should trim the query', () => {
      const query = '  SELECT * FROM users  ';
      const result = queryUtils.formatQueryScan(query);
      
      expect(result).toBe('SELECT * FROM users');
    });
  });

  describe('isDuplicateQuery', () => {
    it('should identify exact duplicates', () => {
      const queries: QueryInfo[] = [
        { query: 'SELECT * FROM users', isNative: true },
        { query: 'SELECT name FROM customers', isNative: true }
      ];
      
      const newQuery = 'SELECT * FROM users';
      const result = queryUtils.isDuplicateQuery(queries, newQuery);
      
      expect(result).toBe(true);
    });

    it('should identify duplicates with different whitespace', () => {
      const queries: QueryInfo[] = [
        { query: 'SELECT * FROM users', isNative: true }
      ];
      
      const newQuery = 'SELECT *   FROM\nusers';
      const result = queryUtils.isDuplicateQuery(queries, newQuery);
      
      expect(result).toBe(true);
    });

    it('should return false for non-duplicates', () => {
      const queries: QueryInfo[] = [
        { query: 'SELECT * FROM users', isNative: true }
      ];
      
      const newQuery = 'SELECT * FROM customers';
      const result = queryUtils.isDuplicateQuery(queries, newQuery);
      
      expect(result).toBe(false);
    });

    it('should return false for empty queries list', () => {
      const queries: QueryInfo[] = [];
      
      const newQuery = 'SELECT * FROM users';
      const result = queryUtils.isDuplicateQuery(queries, newQuery);
      
      expect(result).toBe(false);
    });
  });

  // Testes de integração para testar a lógica completa
  describe('integration tests', () => {
    it('should correctly process mixed query types in a complex file', () => {
      const text = `
        // Native SQL examples
        String sql1 = "SELECT * FROM users WHERE active = true";
        String sql2 = "SELECT id, name FROM products " +
                      "WHERE category_id = 5 " +
                      "ORDER BY name";
                      
        // JPQL examples
        String jpql1 = "SELECT e FROM Employee e WHERE e.department.name = 'IT'";
        String jpql2 = "SELECT NEW com.example.dto.UserSummary(u.id, u.name) " +
                       "FROM User u " +
                       "WHERE u.active = true";
                       
        // Method calls
        entityManager.createQuery("SELECT o FROM Order o JOIN FETCH o.items WHERE o.status = :status");
        entityManager.createNativeQuery("SELECT * FROM orders WHERE created_date > SYSDATE - 30");
        
        // Annotations
        @Query("SELECT u FROM User u WHERE u.email = ?1")
        public User findByEmail(String email);
        
        @Query(value = "SELECT * FROM product WHERE price < ?1", nativeQuery = true)
        public List<Product> findCheaperThan(BigDecimal price);
        
        @NamedQuery(name = "User.findByUsername", query = "SELECT u FROM User u WHERE u.username = :username")
      `;
      
      const result = queryUtils.scanQueries(text);
      
      expect(result.length).toBe(8);
      
      // Verificar tipos de query (native vs JPQL)
      const nativeQueries = result.filter(q => q.isNative);
      const jpqlQueries = result.filter(q => !q.isNative);
      
      expect(nativeQueries.length).toBe(4);
      expect(jpqlQueries.length).toBe(4);
      
      // Verificar queries específicas
      expect(result.some(q => q.query.includes('SELECT * FROM users'))).toBe(true);
      expect(result.some(q => q.query.includes('SELECT id, name FROM products'))).toBe(true);
      expect(result.some(q => q.query.includes('SELECT e FROM Employee'))).toBe(true);
      expect(result.some(q => q.query.includes('SELECT NEW com.example.dto.UserSummary'))).toBe(true);
      expect(result.some(q => q.query.includes('JOIN FETCH o.items'))).toBe(true);
      expect(result.some(q => q.query.includes('SELECT * FROM orders'))).toBe(true);
      expect(result.some(q => q.query.includes('SELECT u FROM User u WHERE u.email'))).toBe(true);
      expect(result.some(q => q.query.includes('SELECT * FROM product WHERE price'))).toBe(true);
    });

    it('should handle edge cases and special SQL functions', () => {
      const text = `
        String complexSql = "SELECT to_char(created_date, 'YYYY-MM-DD) as formatted_date, " +
                           "count(*) as total " +
                           "FROM orders " +
                           "GROUP BY to_char(created_date, 'YYYY-MM-DD)";
                           
        String nestedJpql = "SELECT o FROM Order o " +
                           "JOIN o.customer c " +
                           "JOIN c.addresses a " +
                           "WHERE a.city = :city";
      `;
      
      const result = queryUtils.scanQueries(text);
      
      expect(result.length).toBe(2);
      
      // Verifique se corrigiu os problemas de aspas no to_char
      const sqlQuery = result.find(q => q.isNative);
      expect(sqlQuery).toBeDefined();
      expect(sqlQuery?.query).toContain("'YYYY-MM-DD'");
      
      // Verifique se identificou corretamente a query JPQL
      const jpqlQuery = result.find(q => !q.isNative);
      expect(jpqlQuery).toBeDefined();
      expect(jpqlQuery?.query).toContain("SELECT o FROM Order o");
    });
  });
});