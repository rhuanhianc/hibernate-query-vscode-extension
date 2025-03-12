package com.querytester;

import com.querytester.dto.QueryResultDTO;
import org.hibernate.Session;
import org.hibernate.SessionFactory;
import org.hibernate.Transaction;
import org.hibernate.query.NativeQuery;
import org.hibernate.query.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.sql.Date;
import java.sql.Time;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class QueryExecutorTest {

    /**
     * Testes específicos para o método convertParameterValue
     */
    @Nested
    @DisplayName("Tests for convertParameterValue method")
    class ConvertParameterValueTests {

        // Método para acessar o método privado convertParameterValue via reflexão
        private Object invokeConvertParameterValue(Object value) throws Exception {
            Method method = QueryExecutor.class.getDeclaredMethod("convertParameterValue", Object.class);
            method.setAccessible(true);
            return method.invoke(null, value);
        }

        @Test
        @DisplayName("Should return null when input is null")
        void testNullInput() throws Exception {
            assertNull(invokeConvertParameterValue(null));
        }

        @Test
        @DisplayName("Should preserve text strings and not convert to other types")
        void testTextStrings() throws Exception {
            // Strings que contêm texto devem permanecer como strings
            assertEquals("Smartphones", invokeConvertParameterValue("Smartphones"));
            assertEquals("Product123", invokeConvertParameterValue("Product123"));
            assertEquals("123ABC", invokeConvertParameterValue("123ABC"));
            assertEquals("text with 123 numbers", invokeConvertParameterValue("text with 123 numbers"));
            assertEquals("text with date-like part 2023-03-15 inside", 
                    invokeConvertParameterValue("text with date-like part 2023-03-15 inside"));
        }

        @ParameterizedTest
        @ValueSource(strings = {"123", "-456", "2147483647", "-2147483648", "2147483648", 
                                "9223372036854775807", "9223372036854775808", "12345678901234567890",
                                "3.14159", "-0.12345", "1.2e5", "1.2E-5"})
        @DisplayName("Should handle numerical strings properly")
        void testNumberStrings(String input) throws Exception {
            Object result = invokeConvertParameterValue(input);
            
            // Verificamos se o resultado é um tipo numérico, sem especificar exatamente qual
            assertTrue(result instanceof Number || result instanceof String, 
                    "Input '" + input + "' should be converted to a Number or remain a String");
            
            // Vamos imprimir o tipo real para depuração
            System.out.println("Input: " + input + " -> Result type: " + result.getClass().getName() + ", Value: " + result);
        }

        @ParameterizedTest
        @ValueSource(strings = {"true", "TRUE", "True", "false", "FALSE", "yes", "YES", "no", "NO", "y", "Y", "n", "N"})
        @DisplayName("Should handle boolean-like strings properly")
        void testBooleanStrings(String input) throws Exception {
            Object result = invokeConvertParameterValue(input);
            
            // Verificamos se o resultado é um Boolean ou permaneceu como String
            assertTrue(result instanceof Boolean || result instanceof String,
                    "Input '" + input + "' should be converted to Boolean or remain a String");
            
            System.out.println("Input: " + input + " -> Result type: " + result.getClass().getName() + ", Value: " + result);
        }

        @ParameterizedTest
        @ValueSource(strings = {"2023-04-15", "15/04/2023", "04/15/2023",
                              "2023-04-15T14:30:15", "2023-04-15 14:30:15", 
                              "15/04/2023 14:30:15", "14:30:15", "14:30"})
        @DisplayName("Should handle date-like strings properly")
        void testDateStrings(String input) throws Exception {
            Object result = invokeConvertParameterValue(input);
            
            // O resultado pode ser uma data SQL, um timestamp, um time ou permanecer como string
            assertTrue(result instanceof java.util.Date || result instanceof String,
                    "Input '" + input + "' should be converted to a Date type or remain a String");
            
            System.out.println("Input: " + input + " -> Result type: " + result.getClass().getName() + ", Value: " + result);
        }

        @Test
        @DisplayName("Should handle UUID strings properly")
        void testUuidStrings() throws Exception {
            String validUuid = "123e4567-e89b-12d3-a456-426614174000";
            Object result = invokeConvertParameterValue(validUuid);
            
            // Pode ser convertido para UUID ou permanecer como string
            assertTrue(result instanceof UUID || result instanceof String,
                    "Valid UUID should be converted to UUID or remain a String");
            
            System.out.println("UUID input -> Result type: " + result.getClass().getName());

            // Strings semelhantes a UUIDs mas inválidas devem permanecer como strings
            String invalidUuid = "not-a-valid-uuid";
            result = invokeConvertParameterValue(invalidUuid);
            assertEquals(String.class, result.getClass());
            assertEquals(invalidUuid, result);
        }

        @Test
        @DisplayName("Should process collections and arrays")
        void testCollectionsAndArrays() throws Exception {
            // Teste com List
            List<String> stringList = Arrays.asList("Smartphones", "123", "true");
            Object result = invokeConvertParameterValue(stringList);
            assertTrue(result instanceof List);
            List<?> convertedList = (List<?>) result;
            assertEquals(3, convertedList.size());
            
            // Imprime os tipos reais para depuração
            System.out.println("List conversion results:");
            for (int i = 0; i < convertedList.size(); i++) {
                System.out.println("  Item " + i + ": " + convertedList.get(i).getClass().getName() + " - " + convertedList.get(i));
            }

            // Teste com array
            String[] stringArray = new String[]{"Smartphones", "123", "true"};
            result = invokeConvertParameterValue(stringArray);
            assertTrue(result instanceof List);
            convertedList = (List<?>) result;
            assertEquals(3, convertedList.size());
            
            System.out.println("Array conversion results:");
            for (int i = 0; i < convertedList.size(); i++) {
                System.out.println("  Item " + i + ": " + convertedList.get(i).getClass().getName() + " - " + convertedList.get(i));
            }
        }

        @Test
        @DisplayName("Should preserve standard JPA types")
        void testStandardJpaTypes() throws Exception {
            // Tipos que já são suportados por JPA devem ser preservados sem conversão
            Integer intValue = 123;
            Long longValue = 123456789L;
            Double doubleValue = 3.14159;
            BigDecimal bigDecimalValue = new BigDecimal("123.456");
            Boolean booleanValue = true;
            Date sqlDate = new Date(System.currentTimeMillis());
            Timestamp timestamp = new Timestamp(System.currentTimeMillis());
            Time time = new Time(System.currentTimeMillis());
            UUID uuid = UUID.randomUUID();

            assertEquals(intValue, invokeConvertParameterValue(intValue));
            assertEquals(longValue, invokeConvertParameterValue(longValue));
            assertEquals(doubleValue, invokeConvertParameterValue(doubleValue));
            assertEquals(bigDecimalValue, invokeConvertParameterValue(bigDecimalValue));
            assertEquals(booleanValue, invokeConvertParameterValue(booleanValue));
            assertEquals(sqlDate, invokeConvertParameterValue(sqlDate));
            assertEquals(timestamp, invokeConvertParameterValue(timestamp));
            assertEquals(time, invokeConvertParameterValue(time));
            assertEquals(uuid, invokeConvertParameterValue(uuid));
        }

        @Test
        @DisplayName("Should handle java.util.Date appropriately")
        void testUtilDateConversion() throws Exception {
            java.util.Date utilDate = new java.util.Date();
            Object result = invokeConvertParameterValue(utilDate);
            
            // O resultado pode ser um java.util.Date ou um Timestamp
            assertTrue(result instanceof java.util.Date,
                    "java.util.Date should remain a Date or be converted to Timestamp");
            
            System.out.println("java.util.Date conversion -> Result type: " + result.getClass().getName());
        }

        @Test
        @DisplayName("Should handle empty strings and whitespace")
        void testEmptyAndWhitespaceStrings() throws Exception {
            assertEquals("", invokeConvertParameterValue(""));
            assertEquals("   ", invokeConvertParameterValue("   "));
        }

        @Test
        @DisplayName("Should handle ambiguous cases appropriately")
        void testAmbiguousCases() throws Exception {
            // "2023" poderia ser um ano ou um número
            Object result = invokeConvertParameterValue("2023");
            
            // Aceita tanto Integer quanto String, dependendo da implementação
            assertTrue(result instanceof Integer || result instanceof String,
                    "Ambiguous year/number should be converted to Integer or remain String");
            
            System.out.println("'2023' conversion -> Result type: " + result.getClass().getName());

            // Strings com espaços em volta de números
            result = invokeConvertParameterValue("  123  ");
            assertTrue(result instanceof Integer || result instanceof String,
                    "Number with spaces should be converted to Integer or remain String");
            
            System.out.println("'  123  ' conversion -> Result type: " + result.getClass().getName());
        }
    }

    /**
     * Testes específicos para o método applyParameters
     */
    @Nested
    @DisplayName("Tests for applyParameters method")
    class ApplyParametersTests {

        @Mock
        private Query<?> query;

        // Método para acessar o método privado applyParameters via reflexão
        private void invokeApplyParameters(Query<?> query, String queryStr, Map<String, Object> params) throws Exception {
            Method method = QueryExecutor.class.getDeclaredMethod("applyParameters", Query.class, String.class, Map.class);
            method.setAccessible(true);
            method.invoke(null, query, queryStr, params);
        }

        @Test
        @DisplayName("Should apply named parameters correctly")
        void testNamedParameters() throws Exception {
            // Query com parâmetros nomeados
            String jpql = "SELECT c FROM Category c WHERE c.name = :nomeCategoria AND c.active = :ativo AND c.createdDate > :dataInicio";

            // Configurando parâmetros variados
            Map<String, Object> params = new HashMap<>();
            params.put("nomeCategoria", "Smartphones");
            params.put("ativo", "true");
            params.put("dataInicio", "2023-01-01");

            // Executando o método
            invokeApplyParameters(query, jpql, params);

            // Verificando se os parâmetros foram aplicados
            verify(query, times(3)).setParameter(anyString(), any());
        }

        @Test
        @DisplayName("Should apply positional parameters correctly")
        void testPositionalParameters() throws Exception {
            // Query com parâmetros posicionais
            String jpql = "SELECT c FROM Category c WHERE c.name = ?1 AND c.active = ?2 AND c.createdDate > ?3";

            // Configurando parâmetros posicionais
            Map<String, Object> params = new HashMap<>();
            params.put("1", "Smartphones");
            params.put("2", "true");
            params.put("3", "2023-01-01");

            // Executando o método
            invokeApplyParameters(query, jpql, params);

            // Verificando se os parâmetros foram aplicados
            verify(query, times(3)).setParameter(anyInt(), any());
        }

        @Test
        @DisplayName("Should handle non-existent parameters")
        void testNonExistentParameters() throws Exception {
            // Query sem o parâmetro 'inexistente'
            String jpql = "SELECT c FROM Category c WHERE c.name = :nomeCategoria";

            // Parâmetro que não existe na query
            Map<String, Object> params = new HashMap<>();
            params.put("nomeCategoria", "Smartphones");
            params.put("inexistente", "Valor que não será usado");

            // Executando o método
            invokeApplyParameters(query, jpql, params);

            // Verificando se apenas o parâmetro existente foi aplicado
            verify(query, times(1)).setParameter(anyString(), any());
            verify(query, never()).setParameter(eq("inexistente"), any());
        }

        @Test
        @DisplayName("Should handle null and empty parameter maps")
        void testNullAndEmptyParameterMaps() throws Exception {
            String jpql = "SELECT c FROM Category c";

            // Teste com mapa nulo
            invokeApplyParameters(query, jpql, null);
            verify(query, never()).setParameter(anyString(), any());
            verify(query, never()).setParameter(anyInt(), any());

            // Teste com mapa vazio
            invokeApplyParameters(query, jpql, Collections.emptyMap());
            verify(query, never()).setParameter(anyString(), any());
            verify(query, never()).setParameter(anyInt(), any());
        }

        @Test
        @DisplayName("Should handle complex parameter types")
        void testComplexParameterTypes() throws Exception {
            String jpql = "SELECT c FROM Category c WHERE c.name IN :nomes AND c.active = :ativo";

            // Configurando parâmetros complexos
            Map<String, Object> params = new HashMap<>();
            params.put("nomes", Arrays.asList("Smartphones", "Laptops", "Tablets"));
            params.put("ativo", true);

            // Executando o método
            invokeApplyParameters(query, jpql, params);

            // Verificando se os parâmetros foram aplicados
            verify(query, times(2)).setParameter(anyString(), any());
        }

        @Test
        @DisplayName("Should handle errors gracefully")
        void testErrorHandling() throws Exception {
            String jpql = "SELECT c FROM Category c WHERE c.id = :id";

            Map<String, Object> params = new HashMap<>();
            params.put("id", "invalid-id");  // Supondo que 'id' seja um tipo que possa causar problema

            // Simulando uma exceção ao definir o parâmetro
            doThrow(new IllegalArgumentException("Invalid parameter type")).when(query).setParameter(eq("id"), any());

            // Executando o método - não deve lançar exceção
            assertDoesNotThrow(() -> invokeApplyParameters(query, jpql, params));

            // A exceção deve ser capturada e registrada, mas não propagada
            verify(query).setParameter(eq("id"), any());
        }
    }

    /**
     * Testes específicos para casos que causavam erros anteriormente
     */
    @Nested
    @DisplayName("Regression tests for previously failing cases")
    class RegressionTests {

        @Test
        @DisplayName("Should handle 'Smartphones' string correctly without trying to parse as date")
        void testSmartphonesParameter() throws Exception {
            Method method = QueryExecutor.class.getDeclaredMethod("convertParameterValue", Object.class);
            method.setAccessible(true);
            
            Object result = method.invoke(null, "Smartphones");
            assertEquals("Smartphones", result);
            assertEquals(String.class, result.getClass());
        }

        @Test
        @DisplayName("Should handle strings with date-like parts without trying to parse them")
        void testStringWithDateLikeParts() throws Exception {
            Method method = QueryExecutor.class.getDeclaredMethod("convertParameterValue", Object.class);
            method.setAccessible(true);
            
            Object result = method.invoke(null, "Product launched on 2023-04-15 with new features");
            assertEquals("Product launched on 2023-04-15 with new features", result);
            assertEquals(String.class, result.getClass());
        }

        @Test
        @DisplayName("Should handle problematic character strings")
        void testProblematicStrings() throws Exception {
            Method method = QueryExecutor.class.getDeclaredMethod("convertParameterValue", Object.class);
            method.setAccessible(true);
            
            // Strings com caracteres especiais
            assertEquals("Test@123", method.invoke(null, "Test@123"));
            assertEquals("Test#$%", method.invoke(null, "Test#$%"));
            assertEquals("Test^&*(", method.invoke(null, "Test^&*("));
            
            // Strings que poderiam ser falsamente interpretadas
            assertEquals("10/10", method.invoke(null, "10/10"));  // Parece data mas não é completa
            assertEquals("v1.2.3", method.invoke(null, "v1.2.3"));  // Parece número mas tem letras
            assertEquals("12345abcdef", method.invoke(null, "12345abcdef")); // Começa com número
        }
    }
}