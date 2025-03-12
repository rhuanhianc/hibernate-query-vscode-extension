package com.querytester;

import com.google.gson.Gson;
import com.querytester.dto.QueryResultDTO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.*;
import java.net.Socket;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ServerTest {
    
    private MockedStatic<HibernateManager> hibernateManagerMock;
    private MockedStatic<QueryExecutor> queryExecutorMock;
    private final Gson gson = new Gson();
    
    @BeforeEach
    void setUp() {
        hibernateManagerMock = mockStatic(HibernateManager.class);
        queryExecutorMock = mockStatic(QueryExecutor.class);
    }
    
    @AfterEach
    void tearDown() {
        hibernateManagerMock.close();
        queryExecutorMock.close();
    }
    
    @Test
    void testHandleClient_ValidJpqlRequest() throws Exception {
        // Socket e streams mockados
        Socket socket = mock(Socket.class);
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        
        // Preparar JSON de requisição
        Server.Request request = new Server.Request();
        request.command = "executeQuery";
        request.query = "SELECT e FROM Entity e";
        request.isNative = false;
        request.params = new HashMap<>();
        
        String requestJson = gson.toJson(request) + "\n";
        
        // Mockar streams de entrada e saída
        when(socket.getInputStream()).thenReturn(new ByteArrayInputStream(requestJson.getBytes()));
        when(socket.getOutputStream()).thenReturn(outputStream);
        
        // Mockar QueryExecutor
        QueryResultDTO expectedResult = new QueryResultDTO();
        expectedResult.setStatus("SUCCESS");
        expectedResult.setMessage("JPQL query executed successfully");
        
        queryExecutorMock.when(() -> QueryExecutor.executeJpql(anyString(), any(), any()))
            .thenReturn(expectedResult);
        
        // Chamar o método sob teste - precisamos usar reflexão para acessar o método privado
        java.lang.reflect.Method handleClientMethod = Server.class.getDeclaredMethod("handleClient", Socket.class);
        handleClientMethod.setAccessible(true);
        handleClientMethod.invoke(null, socket);
        
        // Verificar a saída
        String response = outputStream.toString();
        assertTrue(response.contains("SUCCESS"));
        assertTrue(response.contains("JPQL query executed successfully"));
        
        // Verificar interação com QueryExecutor
        queryExecutorMock.verify(() -> QueryExecutor.executeJpql(eq("SELECT e FROM Entity e"), any(), any()));
    }
    
    @Test
    void testHandleClient_ValidNativeSqlRequest() throws Exception {
        // Socket e streams mockados
        Socket socket = mock(Socket.class);
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        
        // Preparar JSON de requisição
        Server.Request request = new Server.Request();
        request.command = "executeQuery";
        request.query = "SELECT * FROM entity";
        request.isNative = true;
        request.params = new HashMap<>();
        
        String requestJson = gson.toJson(request) + "\n";
        
        // Mockar streams de entrada e saída
        when(socket.getInputStream()).thenReturn(new ByteArrayInputStream(requestJson.getBytes()));
        when(socket.getOutputStream()).thenReturn(outputStream);
        
        // Mockar QueryExecutor
        QueryResultDTO expectedResult = new QueryResultDTO();
        expectedResult.setStatus("SUCCESS");
        expectedResult.setMessage("Native SQL query executed successfully");
        
        queryExecutorMock.when(() -> QueryExecutor.executeNativeSql(anyString(), any()))
            .thenReturn(expectedResult);
        
        // Chamar o método sob teste
        java.lang.reflect.Method handleClientMethod = Server.class.getDeclaredMethod("handleClient", Socket.class);
        handleClientMethod.setAccessible(true);
        handleClientMethod.invoke(null, socket);
        
        // Verificar a saída
        String response = outputStream.toString();
        assertTrue(response.contains("SUCCESS"));
        assertTrue(response.contains("Native SQL query executed successfully"));
        
        // Verificar interação com QueryExecutor
        queryExecutorMock.verify(() -> QueryExecutor.executeNativeSql(eq("SELECT * FROM entity"), any()));
    }
    
    @Test
    void testHandleClient_InvalidRequest() throws Exception {
        // Socket e streams mockados
        Socket socket = mock(Socket.class);
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        
        // Preparar JSON de requisição inválido
        Server.Request request = new Server.Request();
        request.command = "unknownCommand";
        request.query = "SELECT e FROM Entity e";
        
        String requestJson = gson.toJson(request) + "\n";
        
        // Mockar streams de entrada e saída
        when(socket.getInputStream()).thenReturn(new ByteArrayInputStream(requestJson.getBytes()));
        when(socket.getOutputStream()).thenReturn(outputStream);
        
        // Chamar o método sob teste
        java.lang.reflect.Method handleClientMethod = Server.class.getDeclaredMethod("handleClient", Socket.class);
        handleClientMethod.setAccessible(true);
        handleClientMethod.invoke(null, socket);
        
        // Verificar a saída
        String response = outputStream.toString();
        assertTrue(response.contains("ERROR"));
        assertTrue(response.contains("Unknown command"));
    }
    
    @Test
    void testHandleClient_MalformedJson() throws Exception {
        // Socket e streams mockados
        Socket socket = mock(Socket.class);
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        
        // Preparar JSON malformado
        String requestJson = "{invalid json}\n";
        
        // Mockar streams de entrada e saída
        when(socket.getInputStream()).thenReturn(new ByteArrayInputStream(requestJson.getBytes()));
        when(socket.getOutputStream()).thenReturn(outputStream);
        
        // Chamar o método sob teste
        java.lang.reflect.Method handleClientMethod = Server.class.getDeclaredMethod("handleClient", Socket.class);
        handleClientMethod.setAccessible(true);
        handleClientMethod.invoke(null, socket);
        
        // Verificar a saída
        String response = outputStream.toString();
        assertTrue(response.contains("ERROR"));
        assertTrue(response.contains("Error processing request"));
    }
    
    @Test
    void testHandleRequest_NullRequest() {
        // Chamar o método sob teste
        java.lang.reflect.Method handleRequestMethod;
        try {
            handleRequestMethod = Server.class.getDeclaredMethod("handleRequest", Server.Request.class);
            handleRequestMethod.setAccessible(true);
            QueryResultDTO result = (QueryResultDTO) handleRequestMethod.invoke(null, (Server.Request)null);
            
            assertEquals("ERROR", result.getStatus());
            assertTrue(result.getMessage().contains("Invalid request"));
        } catch (Exception e) {
            fail("Exceção não deveria ser lançada: " + e.getMessage());
        }
    }
    
    @Test
    void testHandleRequest_MissingCommandOrQuery() {
        // Preparar requisição com campos ausentes
        Server.Request request = new Server.Request();
        
        // Chamar o método sob teste
        java.lang.reflect.Method handleRequestMethod;
        try {
            handleRequestMethod = Server.class.getDeclaredMethod("handleRequest", Server.Request.class);
            handleRequestMethod.setAccessible(true);
            QueryResultDTO result = (QueryResultDTO) handleRequestMethod.invoke(null, request);
            
            assertEquals("ERROR", result.getStatus());
            assertTrue(result.getMessage().contains("Invalid request"));
        } catch (Exception e) {
            fail("Exceção não deveria ser lançada: " + e.getMessage());
        }
    }
    
    
    @Test
    void testHandleRequest_QueryExecutionError() {
        // Preparar requisição válida
        Server.Request request = new Server.Request();
        request.command = "executeQuery";
        request.query = "SELECT e FROM Entity e";
        request.isNative = false;
        request.params = new HashMap<>();
        request.dbConfig = new HashMap<>();
        
        // Mockar QueryExecutor para lançar exceção
        queryExecutorMock.when(() -> QueryExecutor.executeJpql(anyString(), any(), any()))
            .thenThrow(new RuntimeException("Query execution error"));
        
        // Chamar o método sob teste
        java.lang.reflect.Method handleRequestMethod;
        try {
            handleRequestMethod = Server.class.getDeclaredMethod("handleRequest", Server.Request.class);
            handleRequestMethod.setAccessible(true);
            QueryResultDTO result = (QueryResultDTO) handleRequestMethod.invoke(null, request);
            
            assertEquals("ERROR", result.getStatus());
            assertTrue(result.getMessage().contains("Error executing command"));
        } catch (Exception e) {
            fail("Exceção não deveria ser lançada: " + e.getMessage());
        }
    }
    
    @Test
    void testHandleRequest_FieldsToInclude() {
        // Preparar requisição com campos para incluir
        Server.Request request = new Server.Request();
        request.command = "executeQuery";
        request.query = "SELECT e FROM Entity e";
        request.isNative = false;
        request.params = new HashMap<>();
        request.fieldsToInclude = new String[] {"id", "name"};
        
        // Mockar QueryExecutor
        QueryResultDTO expectedResult = new QueryResultDTO();
        expectedResult.setStatus("SUCCESS");
        
        queryExecutorMock.when(() -> QueryExecutor.executeJpql(anyString(), any(), any()))
            .thenReturn(expectedResult);
        
        // Chamar o método sob teste
        java.lang.reflect.Method handleRequestMethod;
        try {
            handleRequestMethod = Server.class.getDeclaredMethod("handleRequest", Server.Request.class);
            handleRequestMethod.setAccessible(true);
            QueryResultDTO result = (QueryResultDTO) handleRequestMethod.invoke(null, request);
            
            assertEquals("SUCCESS", result.getStatus());
            // Verificar que fieldsToInclude foi processado corretamente
            queryExecutorMock.verify(() -> QueryExecutor.executeJpql(
                eq("SELECT e FROM Entity e"), 
                any(), 
                argThat(set -> set != null && set.contains("id") && set.contains("name") && set.size() == 2)
            ));
        } catch (Exception e) {
            fail("Exceção não deveria ser lançada: " + e.getMessage());
        }
    }
}