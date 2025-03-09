# Hibernate Query Tester Server

A server component that allows executing and testing Hibernate queries (JPQL and native SQL) from VSCode.

## Overview

This server allows you to test your Hibernate/JPA queries against your database directly from VSCode. It supports:

- JPQL and HQL queries
- Native SQL queries
- Dynamic parameter binding
- Multiple database vendors
- Both Hibernate 5.x and Hibernate 6.x

## Features

- **Live Query Testing**: Execute JPQL and SQL queries against your database in real-time
- **Parameter Support**: Test queries with various parameters
- **Entity Scanning**: Automatically scans and loads entity classes
- **Multi-dialect Support**: Works with MySQL, PostgreSQL, Oracle, SQL Server, H2, etc.
- **Configurable**: Supports various database configurations

## Requirements

- Java 11+ JDK
- Maven 3.6+
- Your entity classes in a JAR file or project classpath

## Building the Server

The server can be built for two different Hibernate versions:

### Hibernate 5.x (javax.persistence)

```sh
mvn clean package -Phibernate5 → Generate query-tester-server-hibernate5-1.0-SNAPSHOT.jar.
```

### Hibernate 6.x (jakarta.persistence)

```sh
mvn clean package -Phibernate6 → Generate query-tester-server-hibernate6-1.0-SNAPSHOT.jar.
```