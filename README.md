# Hibernate Query Tester for VS Code

<img src="https://github.com/rhuanhianc/hibernate-query-vscode-extension/blob/main/client/images/icon.png?raw=true" alt="Hibernate Query Tester Logo" width="120" align="right"/>

[![Version](https://img.shields.io/badge/version-0.2.2-blue.svg)](https://marketplace.visualstudio.com/manage/publishers/RhuanHiancextensionshibernate-query-tester)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Test and debug JPQL/HQL and SQL queries directly in VS Code, with full Hibernate support!

![exemple](exemple.gif)

## 📋 Overview

**Hibernate Query Tester** is a VS Code extension that allows you to test and debug your Hibernate (JPQL/HQL) and native SQL queries directly in your editor, providing immediate feedback and formatted results without needing to run your entire application.

### ✨ Key Features

- 🔍 **Execute JPQL/HQL and native SQL queries** directly in VS Code
- 📝 **Parameter editor** to test different scenarios
- 📊 **Results visualization** in table format
- 📚 **Query history** for easy reuse
- ⭐ **Save favorite queries** for quick access
- 🔄 **Auto-detection of parameters** in queries
- 🔎 **Automatic scanner** to find queries in your code
- 🔧 **Support for Hibernate 5 and 6**
- 📦 **Parameter sets** reusable across different queries
- 📜 **Log Level Configuration** to control the verbosity of the logs

## 🔧 Installation

1. Open VS Code
2. Access the extensions view (Ctrl+Shift+X)
3. Search for "Hibernate Query Tester"
4. Click "Install"

### Prerequisites

- Java Runtime Environment (JRE) 8 or higher
- VS Code 1.85.0 or higher

## 🚀 How to Use

### Testing a query

1. Open the Query Tester panel by clicking the database icon in the activity bar or using the shortcut `Ctrl+Shift+Q` (Cmd+Shift+Q on Mac)
2. Type your JPQL/HQL query in the query editor
3. Add parameters, if necessary
4. Click "Execute Query" to see the results

### Testing queries from your code

1. Select a query in a .java or .kt file
2. Right-click and select "Test Query with Query Tester" or use the shortcut `Ctrl+Shift+Q`
3. The query will be automatically sent to the Query Tester panel

### Scanning queries from the current file

1. Open a Java or Kotlin file with queries
2. In the Query Tester panel, click the "Scan Queries" button
3. Detected queries will be listed for quick selection

## ⚙️ Configuration

The extension can be configured via the VS Code settings file (settings.json):

```json
{
  "queryTester.hibernateVersion": "5.5.3",
  "queryTester.dbConfig": {
    "url": "jdbc:postgresql://localhost:5432/mydb",
    "username": "user",
    "password": "password",
    "driver": "org.postgresql.Driver"
  },
  "queryTester.entityLibPath": "/path/to/my-project.jar",
  "queryTester.entityPackages": ["com.myapp.model", "com.myapp.entity"],
  "queryTester.projectScan": true,
  "queryTester.serverHost": "127.0.0.1",
  "queryTester.serverPort": 8089
}
```

### Configuration Options

| Option | Description |
|-------|-----------|
| `queryTester.hibernateVersion` | Hibernate version to be used (5.5.3 or 6.0.0) |
| `queryTester.dbConfig` | Database connection settings |
| `queryTester.entityLibPath` | Path to the JAR containing the project entities |
| `queryTester.entityPackages` | List of packages to scan for entities |
| `queryTester.projectScan` | Whether to scan the current project for entities |
| `queryTester.autoFormat` | Automatically format queries when loading them |
| `queryTester.serverHost` | Query Tester Java server host (default: 127.0.0.1) |
| `queryTester.serverPort` | Query Tester Java server port (default: 8089) |

## 🏗️ Architecture

The extension consists of two main components:

### 1. Client (VS Code Extension)

The client is implemented in TypeScript and is responsible for:
- Displaying the graphical interface in VS Code
- Managing query history and favorites
- Sending queries to the Java server
- Presenting results in a user-friendly manner

Main modules:
- `extension.ts`: Initializes the extension and manages the lifecycle
- `sidebar.ts`: Implements the sidebar panel user interface
- `queryClient.ts`: Manages communication with the Java server
- `storage.ts`: Handles the storage of history, favorite queries, and parameter sets

### 2. Server (Java Application)

The server is implemented in Java and executes queries in Hibernate:
- Starts automatically when the extension is activated
- Dynamically configures Hibernate based on settings
- Executes queries and returns formatted results

Main classes:
- `Server.java`: Manages connections and routes requests
- `QueryExecutor.java`: Executes JPQL and native SQL queries
- `HibernateManager.java`: Configures the Hibernate session factory
- `EntityScanner.java`: Scans entities for mapping

## 🔍 Operational Details

1. When the extension is activated, it automatically starts the Java server using Node.js's child_process API.
2. The client connects to the server via TCP socket on the configured port (default: 8089).
3. When a query is executed:
   - The client sends the query, parameters, and settings to the server
   - The server configures Hibernate as needed
   - The query is executed in a transaction
   - Results are converted to a user-friendly JSON format
   - Results are sent back to the client and displayed in the UI

## 🛠️ Detailed Features

### Query Editor

The query editor provides:
- Syntax highlighting for JPQL/HQL
- Formatting button to improve readability
- Option to toggle between JPQL/HQL and native SQL queries

### Parameter Management

The extension offers:
- Automatic detection of named and positional parameters (:name, ?1)
- Parameter editor with validation
- Saving parameter sets for reuse

### Results Visualization

Results are presented in:
- Interactive table format
- With details about execution time and number of records
- Option to copy results as JSON

### History and Favorites

Allows:
- Access to previously executed queries
- Save favorite queries with custom names
- Organize queries by frequent use

## 📑 Examples

### Basic JPQL Query

```sql
SELECT e FROM Employee e WHERE e.department.name = :deptName
```

### Query with JOIN

```sql
SELECT c, o.orderDate
FROM Customer c JOIN c.orders o
WHERE c.status = :status
AND o.orderDate > :minDate
ORDER BY o.orderDate DESC
```

### Native SQL Query

```sql
SELECT p.id, p.name, p.price, c.name as category
FROM products p
JOIN categories c ON p.category_id = c.id
WHERE p.price BETWEEN :minPrice AND :maxPrice
```

## ❓ Troubleshooting

### Server doesn't start

1. Check if JRE is installed correctly
2. Check if port 8089 is not being used by another application
3. Check the extension logs in the VS Code "Output" menu (Channel: Query Tester)

### Error when executing queries

1. Check if the database configuration is correct
2. Check if the JDBC driver is available
3. Check if entities are being found correctly

### Entities not found

1. Check the path to the entities JAR
2. Make sure packages are configured correctly
3. Enable project scanning if entities are in the current project

## Release Notes

### 0.2.2

- Improved code quality
- Added UTF-8 support when reading and writing client data
- Added response timeout setting in QueryClient to wait longer for response
- Added pagination to the results table and updates the interface to display the total number of records
- Fixed minor bugs

### 0.2.1

- Fixed modal for saving queries
- Improved loading queries with command or scan
- Updated icon and package.json

### 0.2.0

- Added support for Persistence.xml path
- Improved entity scanning
- Add support for port dynamic in start server
- Imporved error handling
- Fixed minor bugs

### 0.1.5

- Added log level configuration
- Improved error handling
- Fixed minor bugs

### 0.1.0

- Initial release of Hibernate Query Tester.

## 📣 Feedback and Contributions

If you find bugs or have suggestions for improvements:

- [Open an issue on GitHub](https://github.com/rhuanhianc/hibernate-query-vscode-extension/issues)
- [Contribute to the source code](https://github.com/rhuanhianc/hibernate-query-vscode-extension)

## 📜 License

This extension is licensed under the [MIT License](LICENSE).

---

## Author

- [Rhuan Hianc](https://github.com/rhuanhianc)

**Note:** This is a study project and is currently under development. Feedback and contributions are welcome!

## Telemetry Temporary

This extension collects anonymous usage data to help improve the product. We only collect:

- Extension installs
- Extension activations
- Errors during execution

We do not collect any query content, database settings, or personal information.

You can disable telemetry in the extension settings or in VS Code.
