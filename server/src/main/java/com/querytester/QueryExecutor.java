package com.querytester;

import com.querytester.dto.QueryResultDTO;
import org.hibernate.Session;
import org.hibernate.proxy.HibernateProxy;
import org.hibernate.query.Query;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.stream.Collectors;

import javax.persistence.*;

public class QueryExecutor {
    private static final Logger LOG = LoggerFactory.getLogger(QueryExecutor.class);

    // Cache to improve performance
    private static final Map<Class<?>, List<Field>> ENTITY_FIELDS_CACHE = new HashMap<>();
    private static final Map<Class<?>, List<Field>> COLUMN_FIELDS_CACHE = new HashMap<>();
    private static final Map<Class<?>, Field> ID_FIELD_CACHE = new HashMap<>();

    public static QueryResultDTO executeJpql(String jpql, Map<String, Object> params) {
        return executeJpql(jpql, params, null);
    }

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
     * Aplica parâmetros a uma query, com suporte a diferentes tipos e formatos
     * 
     * @param query    A query onde os parâmetros serão aplicados
     * @param queryStr A string da query original para verificação de parâmetros nomeados
     * @param params   Mapa de parâmetros a serem aplicados
     */
    private static void applyParameters(Query<?> query, String queryStr, Map<String, Object> params) {
        if (params == null || params.isEmpty()) {
            return;
        }

        // Process each parameter
        params.forEach((key, value) -> {
            try {
                if (queryStr.contains(":" + key)) {
                    Object convertedValue = convertParameterValue(value);
                    LOG.debug("Applying named parameter: {} = {} (converted from {})", key, convertedValue, value);
                    query.setParameter(key, convertedValue);
                }
                else if (key.matches("\\d+")) {
                    int position = Integer.parseInt(key);
                    Object convertedValue = convertParameterValue(value);
                    LOG.debug("Applying positional parameter: {} = {} (converted from {})", position, convertedValue, value);
                    query.setParameter(position, convertedValue);
                } else {
                    LOG.debug("Parameter {} not found in query, skipping", key);
                }
            } catch (Exception e) {
                LOG.error("Error applying parameter {}: {}", key, e.getMessage(), e);
                // Log mais detalhes para depuração
                if (value != null) {
                    LOG.error("Parameter value type: {}, value: {}", value.getClass().getName(), value);
                }
                
            }
        });
    }

    /**
     * Converte o valor do parâmetro para o tipo mais apropriado
     * 
     * @param value O valor a ser convertido
     * @return O valor convertido
     */
    private static Object convertParameterValue(Object value) {
        if (value == null) {
            return null;
        }

        // Handle Collections and Arrays
        if (value instanceof Collection) {
            return ((Collection<?>) value).stream().map(QueryExecutor::convertParameterValue).collect(Collectors.toList());
        }

        if (value.getClass().isArray()) {
            Object[] array = convertToObjectArray(value);
            List<Object> result = new ArrayList<>(array.length);
            for (Object item : array) {
                result.add(convertParameterValue(item));
            }
            return result;
        }

        // If already a standard JPA supported type, return as is
        if (isJpaStandardType(value)) {
            return value;
        }

        // Handle String conversions
        if (value instanceof String) {
            String strValue = (String) value;

            // Empty string check
            if (strValue.trim().isEmpty()) {
                return strValue;
            }

            // Strings that clearly look like text and not other data types
            // Assume strings with letters or special characters are meant to be kept as strings
            if (strValue.matches(".*[a-zA-Z].*") && !isLikelyBoolean(strValue)) {
                return strValue;
            }

            // Conversion to numbers - only if the string looks exactly like a number
            if (strValue.matches("^-?\\d+(\\.\\d+)?([Ee][+-]?\\d+)?$")) {
                try {
                    if (!strValue.contains(".") && !strValue.contains("e") && !strValue.contains("E")) {
                        // Integer types
                        try {
                            long longVal = Long.parseLong(strValue);
                            if (longVal >= Integer.MIN_VALUE && longVal <= Integer.MAX_VALUE) {
                                return (int) longVal;
                            }
                            return longVal;
                        } catch (NumberFormatException e) {
                            // If the number is too large for Long, try BigInteger
                            try {
                                return new BigInteger(strValue);
                            } catch (NumberFormatException e2) {
                                // If it can't be parsed as BigInteger, keep as string
                                return strValue;
                            }
                        }
                    } else {
                        // Floating point
                        double doubleVal = Double.parseDouble(strValue);
                        // Check if it can be represented as BigDecimal with exact precision
                        try {
                            return new BigDecimal(strValue);
                        } catch (NumberFormatException e) {
                            return doubleVal;
                        }
                    }
                } catch (NumberFormatException e) {
                    LOG.debug("Value '{}' could not be converted to a number", strValue);
                    return strValue;
                }
            }

            // Conversion to booleans - only convert obvious boolean values
            if (isLikelyBoolean(strValue)) {
                return strValue.equalsIgnoreCase("true") || strValue.equalsIgnoreCase("yes") || strValue.equalsIgnoreCase("y") || strValue.equalsIgnoreCase("1");
            }

            // Try to convert to date/time - only if it matches a strict date pattern
            if (isLikelyDateFormat(strValue)) {
                Object dateValue = tryParseDateTime(strValue);
                if (dateValue != null) {
                    return dateValue;
                }
            }

            // Try to convert to UUID - only if it exactly matches UUID format
            if (strValue.matches("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")) {
                try {
                    return UUID.fromString(strValue);
                } catch (IllegalArgumentException e) {
                    LOG.debug("Value '{}' could not be converted to UUID", strValue);
                }
            }

            // If no conversion applied, return the original string
            return strValue;
        }

        // Handle java.util.Date conversion to java.sql types if needed
        if (value instanceof java.util.Date) {
            java.util.Date dateValue = (java.util.Date) value;
            if (!(value instanceof java.sql.Date) && !(value instanceof java.sql.Timestamp) && !(value instanceof java.sql.Time)) {
                return new java.sql.Timestamp(dateValue.getTime());
            }
        }

        // Return original value if no conversion is applied
        return value;
    }

    /**
     * Verifica se o valor já é de um tipo padrão suportado por JPA
     */
    private static boolean isJpaStandardType(Object value) {
        return value instanceof Number || value instanceof Boolean || value instanceof Character || value instanceof java.util.Date || value instanceof java.sql.Date || value instanceof java.sql.Timestamp || value instanceof java.sql.Time || value instanceof Calendar || value instanceof UUID || value instanceof byte[] || value instanceof Byte[] || value instanceof Enum<?> || value instanceof BigDecimal || value instanceof BigInteger;
    }

    /**
     * Verifica se uma string provavelmente representa um valor booleano
     */
    private static boolean isLikelyBoolean(String strValue) {
        return strValue.equalsIgnoreCase("true") || strValue.equalsIgnoreCase("false") || strValue.equalsIgnoreCase("yes") || strValue.equalsIgnoreCase("no") || strValue.equalsIgnoreCase("y") || strValue.equalsIgnoreCase("n") || strValue.equals("1") || strValue.equals("0");
    }

    /**
     * Verifica se uma string provavelmente está em um formato de data
     */
    private static boolean isLikelyDateFormat(String strValue) {
        // Verifique padrões comuns de data usando expressões regulares mais rigorosas
        return strValue.matches("^\\d{4}-\\d{2}-\\d{2}$") || // ISO date: yyyy-MM-dd
                strValue.matches("^\\d{2}/\\d{2}/\\d{4}$") || // dd/MM/yyyy ou MM/dd/yyyy
                strValue.matches("^\\d{8}$") || // yyyyMMdd
                strValue.matches("^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})?$") || // ISO datetime
                strValue.matches("^\\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}:\\d{2}$") || // dd/MM/yyyy HH:mm:ss
                strValue.matches("^\\d{2}:\\d{2}(:\\d{2})?$"); // HH:mm ou HH:mm:ss
    }

    /**
     * Tenta converter string para vários formatos de data/hora
     */
    private static Object tryParseDateTime(String strValue) {
        // List of common date-time patterns to try
        List<String> dateTimePatterns = Arrays.asList(
                "yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy", "yyyyMMdd", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "dd/MM/yyyy HH:mm:ss", "MM/dd/yyyy HH:mm:ss", "HH:mm:ss", "HH:mm"
        );

        for (String pattern : dateTimePatterns) {
            try {
                SimpleDateFormat sdf = new SimpleDateFormat(pattern);
                sdf.setLenient(false);
                java.util.Date date = sdf.parse(strValue);

                // Determine the appropriate SQL type based on pattern
                if (pattern.equals("HH:mm:ss") || pattern.equals("HH:mm")) {
                    return new java.sql.Time(date.getTime());
                } else if (pattern.contains("HH:mm")) {
                    return new java.sql.Timestamp(date.getTime());
                } else {
                    return new java.sql.Date(date.getTime());
                }
            } catch (ParseException e) {
                // Continue to the next pattern
            }
        }

        // Try ISO-8601 format using java.time API (Java 8+)
        try {
            return java.sql.Timestamp.from(Instant.parse(strValue));
        } catch (DateTimeParseException e) {
            // Not an ISO-8601 timestamp
        }

        try {
            LocalDate localDate = LocalDate.parse(strValue);
            return java.sql.Date.valueOf(localDate);
        } catch (DateTimeParseException e) {
            // Not a standard LocalDate format
        }

        try {
            LocalDateTime localDateTime = LocalDateTime.parse(strValue);
            return java.sql.Timestamp.valueOf(localDateTime);
        } catch (DateTimeParseException e) {
            // Not a standard LocalDateTime format
        }

        return null;
    }

    /**
     * Converte arrays de tipos primitivos em arrays de Object
     */
    private static Object[] convertToObjectArray(Object array) {
        if (array instanceof Object[]) {
            return (Object[]) array;
        }

        int length = Array.getLength(array);
        Object[] result = new Object[length];
        for (int i = 0; i < length; i++) {
            result[i] = Array.get(array, i);
        }
        return result;
    }

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
                                map.put(fieldName + "_label", value.toString());
                            } else {
                                map.put(fieldName + "_id", null);
                                map.put(fieldName + "_label", null);
                            }
                        } else {
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

    private static boolean isColumnField(Field field, Class<?> entityClass) {
        // Check JPA column annotations
        if (field.isAnnotationPresent(Column.class) || field.isAnnotationPresent(Id.class) || field.isAnnotationPresent(Basic.class) || field.isAnnotationPresent(Version.class)) {
            return true;
        }

        // Check naming conventions
        String fieldName = field.getName();
        if (fieldName.equals("id") || fieldName.equals("version") || fieldName.contains("_") || (fieldName.startsWith("id") && fieldName.length() > 2 && Character.isUpperCase(fieldName.charAt(2)))) {
            return true;
        }

        // Check field type
        Class<?> type = field.getType();
        if (type.isPrimitive() || type == String.class || Number.class.isAssignableFrom(type) || Date.class.isAssignableFrom(type) || type == Boolean.class) {
            return true;
        }

        // Check annotations on getter
        String getterName = "get" + fieldName.substring(0, 1).toUpperCase() + fieldName.substring(1);
        try {
            Method getter = entityClass.getMethod(getterName);
            return getter.isAnnotationPresent(Column.class) || getter.isAnnotationPresent(Id.class) || getter.isAnnotationPresent(Basic.class);
        } catch (NoSuchMethodException e) {
            // Getter not found
            return false;
        }
    }

    private static boolean isEntityField(Field field, Class<?> entityClass) {
        // Check JPA relationship annotations
        if (field.isAnnotationPresent(ManyToOne.class) || field.isAnnotationPresent(OneToOne.class) || field.isAnnotationPresent(JoinColumn.class)) {
            return true;
        }

        // Check field type
        Class<?> type = field.getType();
        if (type.isAnnotationPresent(Entity.class) || type.isAnnotationPresent(MappedSuperclass.class)) {
            return true;
        }

        // Check annotations on getter
        String getterName = "get" + field.getName().substring(0, 1).toUpperCase() + field.getName().substring(1);
        try {
            Method getter = entityClass.getMethod(getterName);
            return getter.isAnnotationPresent(ManyToOne.class) || getter.isAnnotationPresent(OneToOne.class) || getter.isAnnotationPresent(JoinColumn.class);
        } catch (NoSuchMethodException e) {
            // Getter not found
            return false;
        }
    }

    private static boolean isCollection(Field field) {
        return Collection.class.isAssignableFrom(field.getType()) || field.getType().isArray() || field.isAnnotationPresent(OneToMany.class) || field.isAnnotationPresent(ManyToMany.class);
    }

    private static boolean isEntity(Class<?> type) {
        return type.isAnnotationPresent(Entity.class) || type.isAnnotationPresent(MappedSuperclass.class);
    }

    private static Object extractIdFromEntity(Object entity) {
        if (entity == null) return null;

        try {
            Class<?> entityClass = entity.getClass();

            // Check cache
            Field idField = ID_FIELD_CACHE.get(entityClass);

            if (idField == null) {
                // Look for field with @Id annotation
                for (Field field : getAllEntityFields(entityClass)) {
                    if (field.isAnnotationPresent(Id.class) || field.isAnnotationPresent(EmbeddedId.class)) {
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
        if (value instanceof String || value instanceof Number || value instanceof Boolean || value.getClass().isPrimitive()) {
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

    private static void handleError(QueryResultDTO result, Exception e, String errorPrefix) {
        result.setStatus("ERROR");
        result.setMessage(errorPrefix + ": " + e.getMessage());
        LOG.error("{}: {}", errorPrefix, e.getMessage(), e);
    }
}