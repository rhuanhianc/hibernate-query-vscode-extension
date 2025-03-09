package com.querytester;

import com.querytester.dto.QueryResultDTO;
import org.hibernate.Session;
import org.hibernate.proxy.HibernateProxy;
import org.hibernate.query.Query;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.*;

import javax.persistence.*;

public class QueryExecutor {
    private static final Logger LOG = LoggerFactory.getLogger(QueryExecutor.class);
    
    // Cache to improve performance
    private static final Map<Class<?>, List<Field>> ENTITY_FIELDS_CACHE = new HashMap<>();
    private static final Map<Class<?>, List<Field>> COLUMN_FIELDS_CACHE = new HashMap<>();
    private static final Map<Class<?>, Field> ID_FIELD_CACHE = new HashMap<>();

    /**
     * Executes a JPQL/HQL query
     */
    public static QueryResultDTO executeJpql(String jpql, Map<String, Object> params) {
        return executeJpql(jpql, params, null);
    }

    /**
     * Executes a JPQL/HQL query with field filtering option
     */
    public static QueryResultDTO executeJpql(String jpql, Map<String, Object> params, Set<String> fieldsToInclude) {
        validateInput(jpql, params);
        QueryResultDTO result = new QueryResultDTO();
        long startTime = System.currentTimeMillis();

        try (Session session = HibernateManager.getSessionFactory().openSession()) {
            session.beginTransaction();
            try {
                Query<?> query = session.createQuery(jpql);
                applyParameters(query, jpql, params);
                
                // Execute the query with timeout limit to avoid issues
                query.setTimeout(30); // 30 seconds
                List<?> rawResult = query.getResultList();

                result.setResults(convertToMaps(rawResult, fieldsToInclude));
                result.setStatus("SUCCESS");
                result.setExecutionTime(System.currentTimeMillis() - startTime);
                result.setMessage("JPQL query executed successfully");

                LOG.info("JPQL query executed: {}", jpql);
                LOG.info("Parameters: {}", params);
                LOG.info("Results: {} records", result.getResults().size());
                
                session.getTransaction().commit();
            } catch (Exception e) {
                session.getTransaction().rollback();
                throw e;
            }
        } catch (Exception e) {
            handleError(result, e, "Error executing JPQL");
        }
        return result;
    }

    /**
     * Executes a native SQL query
     */
    public static QueryResultDTO executeNativeSql(String sql, Map<String, Object> params) {
        validateInput(sql, params);
        QueryResultDTO result = new QueryResultDTO();
        long startTime = System.currentTimeMillis();

        try (Session session = HibernateManager.getSessionFactory().openSession()) {
            session.beginTransaction();
            try {
                // Create native query
                Query<?> query = session.createNativeQuery(sql);
                applyParameters(query, sql, params);
                
                // Execute with security timeout
                query.setTimeout(30);
                List<?> rawResult = query.getResultList();

                result.setResults(convertNativeResultToMaps(rawResult));
                result.setStatus("SUCCESS");
                result.setExecutionTime(System.currentTimeMillis() - startTime);
                result.setMessage("Native SQL query executed successfully");

                LOG.info("Native SQL query executed: {}", sql);
                LOG.info("Parameters: {}", params);
                LOG.info("Results: {} records", result.getResults().size());
                
                session.getTransaction().commit();
            } catch (Exception e) {
                session.getTransaction().rollback();
                throw e;
            }
        } catch (Exception e) {
            handleError(result, e, "Error executing native SQL");
        }
        return result;
    }

    /**
     * Converts native query results to uniform map format
     */
    private static List<Map<String, Object>> convertNativeResultToMaps(List<?> rawResult) {
        if (rawResult == null || rawResult.isEmpty()) {
            return Collections.emptyList();
        }

        List<Map<String, Object>> resultMaps = new ArrayList<>();
        Object first = rawResult.get(0);

        // Native SQL results usually come as arrays of Object[]
        if (first instanceof Object[]) {
            for (Object row : rawResult) {
                Object[] rowData = (Object[]) row;
                Map<String, Object> map = new HashMap<>();
                for (int i = 0; i < rowData.length; i++) {
                    map.put("Col" + i, formatBasicValue(rowData[i]));
                }
                resultMaps.add(map);
            }
        } else {
            // For single values (COUNT, SUM, etc.)
            Map<String, Object> map = new HashMap<>();
            map.put("Result", formatBasicValue(first));
            resultMaps.add(map);
            
            // Also add the remaining values
            for (int i = 1; i < rawResult.size(); i++) {
                map = new HashMap<>();
                map.put("Result", formatBasicValue(rawResult.get(i)));
                resultMaps.add(map);
            }
        }
        
        return resultMaps;
    }

    private static void validateInput(String query, Map<String, Object> params) {
        if (query == null || query.trim().isEmpty()) {
            throw new IllegalArgumentException("Query cannot be null or empty");
        }
        if (params == null) {
            params = Collections.emptyMap();
        }
    }

    /**
     * Applies parameters to the query, handling named and positional parameters
     */
    private static void applyParameters(Query<?> query, String queryStr, Map<String, Object> params) {
        if (params == null || params.isEmpty()) return;
        
        // Process each parameter
        params.forEach((key, value) -> {
            try {
                // Check if it's a named parameter
                if (queryStr.contains(":" + key)) {
                    LOG.debug("Applying named parameter: {} = {}", key, value);
                    query.setParameter(key, convertParameterValue(value));
                }
                // Check if it's a positional parameter (usually comes as numbers)
                else if (key.matches("\\d+")) {
                    int position = Integer.parseInt(key);
                    LOG.debug("Applying positional parameter: {} = {}", position, value);
                    query.setParameter(position, convertParameterValue(value));
                }
                else {
                    LOG.warn("Parameter {} not found in query", key);
                }
            } catch (Exception e) {
                LOG.error("Error applying parameter {}: {}", key, e.getMessage(), e);
            }
        });
    }

    /**
     * Converts parameter value to the appropriate type
     */
    private static Object convertParameterValue(Object value) {
        if (value == null) return null;
        
        // Convert string to other types when appropriate
        if (value instanceof String) {
            String strValue = (String) value;
            
            // Conversion to numbers
            try {
                // Test if it's an integer
                if (strValue.matches("-?\\d+")) {
                    // Check if it fits in an Integer
                    if (strValue.length() <= 9) {
                        return Integer.parseInt(strValue);
                    } else {
                        return Long.parseLong(strValue);
                    }
                }
                // Test if it's a decimal number
                else if (strValue.matches("-?\\d+\\.\\d+")) {
                    return Double.parseDouble(strValue);
                }
            } catch (NumberFormatException e) {
                LOG.debug("Value '{}' could not be converted to a number", strValue);
            }
            
            // Conversion to booleans
            if (strValue.equalsIgnoreCase("true") || strValue.equalsIgnoreCase("false")) {
                return Boolean.parseBoolean(strValue);
            }
            
            // Try to convert to date (simplified implementation)
            if (strValue.matches("\\d{4}-\\d{2}-\\d{2}")) {
                try {
                    return java.sql.Date.valueOf(strValue);
                } catch (Exception e) {
                    LOG.debug("Value '{}' could not be converted to a date", strValue);
                }
            }
        }
        
        // Return original value if no conversion is applied
        return value;
    }

    /**
     * Converts JPQL results to maps
     */
    private static List<Map<String, Object>> convertToMaps(List<?> rawResult, Set<String> fieldsToInclude) {
        if (rawResult == null || rawResult.isEmpty()) {
            return Collections.emptyList();
        }

        List<Map<String, Object>> resultMaps = new ArrayList<>();
        Object first = rawResult.get(0);

        if (first instanceof Object[]) {
            // Results from JPQL projections
            for (Object row : rawResult) {
                Object[] rowData = (Object[]) row;
                Map<String, Object> map = new HashMap<>();
                for (int i = 0; i < rowData.length; i++) {
                    map.put("Col" + i, formatBasicValue(rowData[i]));
                }
                resultMaps.add(map);
            }
        } else {
            // Results from entity queries
            for (Object row : rawResult) {
                Object unproxiedRow = unproxy(row);
                Map<String, Object> map = new HashMap<>();
                Class<?> entityClass = unproxiedRow.getClass();
                
                // Get column fields from entity (cached for performance)
                List<Field> columnFields = getColumnFields(entityClass);
                
                // Process each entity field
                for (Field field : columnFields) {
                    String fieldName = field.getName();
                    
                    // Check if the field should be included
                    if (fieldsToInclude != null && !fieldsToInclude.contains(fieldName)) {
                        continue;
                    }
                    
                    try {
                        field.setAccessible(true);
                        Object value = field.get(unproxiedRow);
                        
                        // Check if it's a relation or collection
                        if (isCollection(field)) {
                            // For collections, just count elements or ignore
                            if (value != null) {
                                Collection<?> collection = (Collection<?>) value;
                                map.put(fieldName + "_count", collection.size());
                            } else {
                                map.put(fieldName + "_count", 0);
                            }
                        } else if (isEntity(field.getType())) {
                            // For related entities, extract only the ID
                            if (value != null) {
                                Object idValue = extractIdFromEntity(value);
                                map.put(fieldName + "_id", formatBasicValue(idValue));
                                
                                // Also add the toString() value of the related entity for better visualization
                                map.put(fieldName + "_label", value.toString());
                            } else {
                                map.put(fieldName + "_id", null);
                                map.put(fieldName + "_label", null);
                            }
                        } else {
                            // For basic fields, use the value directly
                            map.put(fieldName, formatBasicValue(value));
                        }
                    } catch (Exception e) {
                        LOG.warn("Error processing field {}: {}", fieldName, e.getMessage());
                        map.put(fieldName, null);
                    }
                }
                
                resultMaps.add(map);
            }
        }
        
        return resultMaps;
    }
    
    /**
     * Gets all fields that represent columns in the database
     */
    private static List<Field> getColumnFields(Class<?> entityClass) {
        // Check cache first
        if (COLUMN_FIELDS_CACHE.containsKey(entityClass)) {
            return COLUMN_FIELDS_CACHE.get(entityClass);
        }
        
        List<Field> columnFields = new ArrayList<>();
        List<Field> allFields = getAllEntityFields(entityClass);
        
        for (Field field : allFields) {
            if (isColumnField(field, entityClass) || isEntityField(field, entityClass)) {
                columnFields.add(field);
            }
        }
        
        // Store in cache
        COLUMN_FIELDS_CACHE.put(entityClass, columnFields);
        return columnFields;
    }
    
    /**
     * Gets all entity fields, including inherited ones
     */
    private static List<Field> getAllEntityFields(Class<?> entityClass) {
        // Check cache first
        if (ENTITY_FIELDS_CACHE.containsKey(entityClass)) {
            return ENTITY_FIELDS_CACHE.get(entityClass);
        }
        
        List<Field> fields = new ArrayList<>();
        Class<?> currentClass = entityClass;
        
        while (currentClass != null && !currentClass.equals(Object.class)) {
            fields.addAll(Arrays.asList(currentClass.getDeclaredFields()));
            currentClass = currentClass.getSuperclass();
        }
        
        // Store in cache
        ENTITY_FIELDS_CACHE.put(entityClass, fields);
        return fields;
    }
    
    /**
     * Checks if a field represents a column in the database
     */
    private static boolean isColumnField(Field field, Class<?> entityClass) {
        // Check JPA column annotations
        if (field.isAnnotationPresent(Column.class) || 
            field.isAnnotationPresent(Id.class) ||
            field.isAnnotationPresent(Basic.class) ||
            field.isAnnotationPresent(Version.class)) {
            return true;
        }
        
        // Check naming conventions
        String fieldName = field.getName();
        if (fieldName.equals("id") || 
            fieldName.equals("version") || 
            fieldName.contains("_") ||
            (fieldName.startsWith("id") && fieldName.length() > 2 && Character.isUpperCase(fieldName.charAt(2)))) {
            return true;
        }
        
        // Check field type
        Class<?> type = field.getType();
        if (type.isPrimitive() || 
            type == String.class || 
            Number.class.isAssignableFrom(type) ||
            Date.class.isAssignableFrom(type) ||
            type == Boolean.class) {
            return true;
        }
        
        // Check annotations on getter
        String getterName = "get" + fieldName.substring(0, 1).toUpperCase() + fieldName.substring(1);
        try {
            Method getter = entityClass.getMethod(getterName);
            return getter.isAnnotationPresent(Column.class) ||
                   getter.isAnnotationPresent(Id.class) ||
                   getter.isAnnotationPresent(Basic.class);
        } catch (NoSuchMethodException e) {
            // Getter not found
            return false;
        }
    }
    
    /**
     * Checks if a field represents a relationship with another entity
     */
    private static boolean isEntityField(Field field, Class<?> entityClass) {
        // Check JPA relationship annotations
        if (field.isAnnotationPresent(ManyToOne.class) || 
            field.isAnnotationPresent(OneToOne.class) ||
            field.isAnnotationPresent(JoinColumn.class)) {
            return true;
        }
        
        // Check field type
        Class<?> type = field.getType();
        if (type.isAnnotationPresent(Entity.class) ||
            type.isAnnotationPresent(MappedSuperclass.class)) {
            return true;
        }
        
        // Check annotations on getter
        String getterName = "get" + field.getName().substring(0, 1).toUpperCase() + field.getName().substring(1);
        try {
            Method getter = entityClass.getMethod(getterName);
            return getter.isAnnotationPresent(ManyToOne.class) ||
                   getter.isAnnotationPresent(OneToOne.class) ||
                   getter.isAnnotationPresent(JoinColumn.class);
        } catch (NoSuchMethodException e) {
            // Getter not found
            return false;
        }
    }
    
    /**
     * Checks if a field is a collection
     */
    private static boolean isCollection(Field field) {
        return Collection.class.isAssignableFrom(field.getType()) ||
               field.getType().isArray() ||
               field.isAnnotationPresent(OneToMany.class) ||
               field.isAnnotationPresent(ManyToMany.class);
    }
    
    /**
     * Checks if a class is a JPA entity
     */
    private static boolean isEntity(Class<?> type) {
        return type.isAnnotationPresent(Entity.class) ||
               type.isAnnotationPresent(MappedSuperclass.class);
    }
    
    /**
     * Extracts the ID from a related entity
     */
    private static Object extractIdFromEntity(Object entity) {
        if (entity == null) return null;
        
        try {
            Class<?> entityClass = entity.getClass();
            
            // Check cache
            Field idField = ID_FIELD_CACHE.get(entityClass);
            
            if (idField == null) {
                // Look for field with @Id annotation
                for (Field field : getAllEntityFields(entityClass)) {
                    if (field.isAnnotationPresent(Id.class) || 
                        field.isAnnotationPresent(EmbeddedId.class)) {
                        idField = field;
                        ID_FIELD_CACHE.put(entityClass, field);
                        break;
                    }
                }
                
                // If not found, look by naming convention
                if (idField == null) {
                    try {
                        idField = entityClass.getDeclaredField("id");
                        ID_FIELD_CACHE.put(entityClass, idField);
                    } catch (NoSuchFieldException e) {
                        // Try getId method
                        try {
                            Method method = entityClass.getMethod("getId");
                            return method.invoke(entity);
                        } catch (NoSuchMethodException ex) {
                            LOG.warn("Could not find ID for {}", entityClass.getName());
                            return null;
                        }
                    }
                }
            }
            
            // Access the ID field
            if (idField != null) {
                idField.setAccessible(true);
                return idField.get(entity);
            }
            
            return null;
        } catch (Exception e) {
            LOG.warn("Error extracting ID: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Removes Hibernate proxies
     */
    private static Object unproxy(Object entity) {
        if (entity instanceof HibernateProxy) {
            HibernateProxy proxy = (HibernateProxy) entity;
            Object impl = proxy.getHibernateLazyInitializer().getImplementation();
            LOG.debug("Unproxied: {} -> {}", entity.getClass().getName(), impl.getClass().getName());
            return impl;
        }
        LOG.debug("Not a proxy: {}", entity.getClass().getName());
        return entity;
    }
    
    /**
     * Formats a basic value (non-entity) for JSON representation
     */
    private static Object formatBasicValue(Object value) {
        if (value == null) return null;
        
        // For simple types, use directly
        if (value instanceof String || 
            value instanceof Number || 
            value instanceof Boolean ||
            value.getClass().isPrimitive()) {
            return value;
        }
        
        // For dates, convert to ISO string
        if (value instanceof Date) {
            return new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss").format((Date) value);
        }
        
        // For enums, use the name
        if (value.getClass().isEnum()) {
            return ((Enum<?>) value).name();
        }
        
        // For other types, use toString
        return value.toString();
    }

    /**
     * Handles errors in query execution
     */
    private static void handleError(QueryResultDTO result, Exception e, String errorPrefix) {
        result.setStatus("ERROR");
        result.setMessage(errorPrefix + ": " + e.getMessage());
        LOG.error("{}: {}", errorPrefix, e.getMessage(), e);
    }
}