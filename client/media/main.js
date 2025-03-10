(function() {
    const vscode = acquireVsCodeApi();
    let activeTab = 'query';
    let activeQueryList = 'scanned';
    let currentResults = null;
    let autoDetectedParams = [];
    let savedParamSets = {};
    let favoriteQueries = {};
    let scannedQueries = [];
    let queryHistory = [];
    
    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            setActiveTab(tabId);
        });
    });
    
    // Query Lists Tabs
    document.querySelectorAll('.query-lists-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const listId = tab.dataset.list;
            setActiveQueryList(listId);
        });
    });
    
    function setActiveTab(tabId) {
        activeTab = tabId;
        
        // Update tab buttons
        document.querySelectorAll('.tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tabId);
        });
        
        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tabId + '-tab');
        });
    }
    
    function setActiveQueryList(listId) {
        activeQueryList = listId;
        
        // Update list tabs
        document.querySelectorAll('.query-lists-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.list === listId);
        });
        
        // Update list content
        document.querySelectorAll('.query-lists-content').forEach(content => {
            content.classList.toggle('active', content.id === listId + '-queries-list');
        });
    }
    
    // Notifications
    function showNotification(message, type = 'info', duration = 5000) {
        const container = document.getElementById('notifications-container');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const iconSvg = type === 'success' 
            ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
            : type === 'error'
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        
        notification.innerHTML = `
            ${iconSvg}
            <span>${message}</span>
            <span class="close-btn">&times;</span>
        `;
        
        container.appendChild(notification);
        
        // Auto-dismiss
        const dismissTimeout = setTimeout(() => {
            notification.remove();
        }, duration);
        
        // Manual dismiss
        notification.querySelector('.close-btn').addEventListener('click', () => {
            clearTimeout(dismissTimeout);
            notification.remove();
        });
    }
    
    // Modal functions
    function openModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    }
    
    function closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
    }
    
    // Setup modal close buttons
    document.querySelectorAll('.modal .close-btn, .modal button[id^="cancel-"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            modal.classList.remove('active');
        });
    });
    
    // Query execution
    document.getElementById('execute-btn').addEventListener('click', () => {
        executeQuery();
    });
    
    function executeQuery() {
        const query = document.getElementById('query-input').value.trim();
        if (!query) {
            showNotification('Please enter a valid query.', 'error');
            return;
        }
        
        const params = {};
        document.querySelectorAll('.param-item').forEach(item => {
            const key = item.querySelector('.param-name').value;
            const value = item.querySelector('.param-value').value;
            if (key) {
                params[key] = value;
            }
        });
        
        const saveParams = document.getElementById('save-params-checkbox').checked;
        const isNative = document.getElementById('is-native-checkbox').checked;
        
        // Show loading state
        document.getElementById('result-placeholder').innerHTML = '<div style="display:flex;align-items:center;gap:10px;"><div class="spinner"></div> Executing query...</div>';
        document.getElementById('result-placeholder').style.display = 'block';
        document.getElementById('result-content').style.display = 'none';
        
        vscode.postMessage({
            command: 'executeQuery',
            query,
            params,
            saveParams,
            isNative
        });
    }
    
    // Format query
    document.getElementById('format-btn').addEventListener('click', () => {
        const query = document.getElementById('query-input').value.trim();
        if (query) {
            vscode.postMessage({
                command: 'formatQuery',
                query
            });
        }
    });
    
    // Clear query
    document.getElementById('clear-query-btn').addEventListener('click', () => {
        document.getElementById('query-input').value = '';
        document.getElementById('is-native-checkbox').checked = false;
        autoDetectedParams = [];
        updateParamsUI();
    });
    
    // Scan queries
    document.getElementById('scan-btn').addEventListener('click', () => {
        vscode.postMessage({ command: 'scanQueries' });
    });
    
    // Save as favorite
    document.getElementById('save-favorite-btn').addEventListener('click', () => {
        const query = document.getElementById('query-input').value.trim();
        if (!query) {
            showNotification('Please enter a query to save as favorite.', 'error');
            return;
        }
        
        openModal('save-favorite-modal');
    });
    
    document.getElementById('confirm-save-favorite').addEventListener('click', () => {
        const name = document.getElementById('favorite-name').value.trim();
        if (!name) {
            showNotification('Please provide a name for the favorite query.', 'error');
            return;
        }
        
        const query = document.getElementById('query-input').value.trim();
        const isNative = document.getElementById('is-native-checkbox').checked;
        
        // Get current params
        const params = {};
        document.querySelectorAll('.param-item').forEach(item => {
            const key = item.querySelector('.param-name').value;
            const value = item.querySelector('.param-value').value;
            if (key) {
                params[key] = value;
            }
        });
        
        vscode.postMessage({
            command: 'saveFavoriteQuery',
            name,
            query,
            params,
            isNative
        });
        
        closeModal('save-favorite-modal');
        document.getElementById('favorite-name').value = '';
    });
    
    // Param set handling
    document.getElementById('save-param-set-btn').addEventListener('click', () => {
        // Check if there are parameters to save
        const paramItems = document.querySelectorAll('.param-item');
        if (paramItems.length === 0) {
            showNotification('No parameters to save.', 'error');
            return;
        }
        
        openModal('save-param-set-modal');
    });
    
    document.getElementById('confirm-save-param-set').addEventListener('click', () => {
        const name = document.getElementById('param-set-name').value.trim();
        if (!name) {
            showNotification('Please provide a name for the parameter set.', 'error');
            return;
        }
        
        // Get current params
        const params = {};
        document.querySelectorAll('.param-item').forEach(item => {
            const key = item.querySelector('.param-name').value;
            const value = item.querySelector('.param-value').value;
            if (key) {
                params[key] = value;
            }
        });
        
        vscode.postMessage({
            command: 'saveParamSet',
            name,
            params
        });
        
        closeModal('save-param-set-modal');
        document.getElementById('param-set-name').value = '';
    });
    
    document.getElementById('load-param-set-btn').addEventListener('click', () => {
        updateParamSetsSelector();
        openModal('load-param-set-modal');
    });
    
    function updateParamSetsSelector() {
        const container = document.getElementById('param-sets-selector');
        container.innerHTML = '';
        
        if (Object.keys(savedParamSets).length === 0) {
            container.innerHTML = '<div class="list-item">No saved parameter sets</div>';
            return;
        }
        
        Object.entries(savedParamSets).forEach(([name, params]) => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.textContent = name;
            
            item.addEventListener('click', () => {
                loadParamSet(name, params);
                closeModal('load-param-set-modal');
            });
            
            container.appendChild(item);
        });
    }
    
    function loadParamSet(name, params) {
        // Clear existing params
        document.getElementById('params-container').innerHTML = '';
        
        // Add params from the set
        Object.entries(params).forEach(([key, value]) => {
            addParamField(key, value);
        });
    }
    
    // Copy results
    document.getElementById('copy-results-btn').addEventListener('click', () => {
        if (currentResults) {
            const jsonStr = JSON.stringify(currentResults, null, 2);
            navigator.clipboard.writeText(jsonStr)
                .then(() => showNotification('Results copied to clipboard!', 'success'))
                .catch(err => showNotification('Error copying results: ' + err, 'error'));
        } else {
            showNotification('No results to copy.', 'info');
        }
    });
    
    // Parameters
    document.getElementById('add-param-btn').addEventListener('click', () => {
        addParamField('', '');
    });
    
    function addParamField(name, value) {
        const container = document.getElementById('params-container');
        const paramItem = document.createElement('div');
        paramItem.className = 'param-item';
        
        paramItem.innerHTML = `
            <input type="text" class="param-name" placeholder="Name" value="${name}">
            <input type="text" class="param-value" placeholder="Value" value="${value}">
            <button class="small secondary remove-param-btn">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;
        
        container.appendChild(paramItem);
        
        paramItem.querySelector('.remove-param-btn').addEventListener('click', () => {
            paramItem.remove();
        });
    }
    
    // Detect parameters from query
    function detectQueryParams(query) {
        if (!query) return [];
        
        // Detect both named parameters (:name) and positional parameters (?1)
        const paramRegex = /(?::([a-zA-Z][a-zA-Z0-9]*)|[\?]([0-9]+))/g;
        const params = [];
        let match;
        
        while ((match = paramRegex.exec(query)) !== null) {
            // match[1] for named params, match[2] for positional params
            const paramName = match[1] || match[2];
            if (!params.includes(paramName)) {
                params.push(paramName);
            }
        }
        
        return params;
    }
    
    function updateParamsUI() {
        const container = document.getElementById('params-container');
        container.innerHTML = '';
        
        // Add fields for detected parameters
        autoDetectedParams.forEach(param => {
            addParamField(param, '');
        });
    }
    
    // Query input change handler to detect parameters
    document.getElementById('query-input').addEventListener('input', (e) => {
        const query = e.target.value;
        autoDetectedParams = detectQueryParams(query);
        updateParamsUI();
    });
    
    // History
    document.getElementById('clear-history-btn').addEventListener('click', () => {
        vscode.postMessage({ command: 'clearQueryHistory' });
    });
    
    function updateHistoryUI(history) {
        const historyList = document.getElementById('history-list');
        historyList.innerHTML = '';
        
        console.log('Updating history UI - type:', typeof history, 'size:', history ? history.length : 0);
        
        if (!history || history.length === 0) {
            historyList.innerHTML = '<div class="list-item">No queries in history</div>';
            return;
        }
        
        history.forEach(item => {
            // Check item format (can be string or object)
            const isStringItem = typeof item === 'string';
            const query = isStringItem ? item : item.query;
            
            if (!query) {
                console.warn('Invalid item in history:', item);
                return; // Skip invalid item
            }
            
            const listItem = document.createElement('div');
            listItem.className = 'list-item';
            
            // Create main content with query and timestamp
            const contentDiv = document.createElement('div');
            contentDiv.style.width = '100%';
            
            const queryText = document.createElement('div');
            queryText.textContent = query.length > 70 ? query.substring(0, 70) + '...' : query;
            queryText.title = query;
            
            // Format timestamp if available
            if (!isStringItem && item.timestamp) {
                const date = new Date(item.timestamp);
                const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
                
                const timestampDiv = document.createElement('div');
                timestampDiv.textContent = formattedDate;
                timestampDiv.style.fontSize = '10px';
                timestampDiv.style.opacity = '0.7';
                contentDiv.appendChild(timestampDiv);
            }
            
            // Add native badge if applicable
            if (!isStringItem && item.isNative) {
                const badge = document.createElement('span');
                badge.className = 'badge warning';
                badge.textContent = 'SQL';
                badge.style.marginLeft = '5px';
                queryText.appendChild(badge);
            }
            
            contentDiv.appendChild(queryText);
            listItem.appendChild(contentDiv);
            
            // Click handler to load query and params
            listItem.addEventListener('click', () => {
                document.getElementById('query-input').value = query;
                document.getElementById('is-native-checkbox').checked = 
                    !isStringItem && item.isNative ? true : false;
                setActiveTab('query');
                
                // Load params
                document.getElementById('params-container').innerHTML = '';
                if (!isStringItem && item.params && Object.keys(item.params).length > 0) {
                    Object.entries(item.params).forEach(([key, value]) => {
                        addParamField(key, value);
                    });
                } else {
                    // Update params UI based on query
                    autoDetectedParams = detectQueryParams(query);
                    updateParamsUI();
                }
            });
            
            historyList.appendChild(listItem);
        });
    }
    
    // Update scanned queries list
    function updateScannedQueriesUI(queries) {
        const container = document.getElementById('scanned-queries-list');
        container.innerHTML = '';
        
        if (!queries || queries.length === 0) {
            container.innerHTML = '<div class="scanned-query">No scanned queries. Use the "Scan Queries" button.</div>';
            return;
        }
        
        queries.forEach(query => {
            const item = document.createElement('div');
            item.className = 'scanned-query';
            item.textContent = query.length > 50 ? query.substring(0, 50) + '...' : query;
            item.title = query;
            
            item.addEventListener('click', () => {
                document.getElementById('query-input').value = query;
                
                // Auto detect params for this query
                autoDetectedParams = detectQueryParams(query);
                updateParamsUI();
            });
            
            container.appendChild(item);
        });
    }
    
    // Update favorites list
    function updateFavoritesUI(favorites) {
        // Update tab favorites list
        const favoritesList = document.getElementById('favorites-list');
        favoritesList.innerHTML = '';
        
        // Update dropdown list
        const favoriteQueriesList = document.getElementById('favorite-queries-list');
        favoriteQueriesList.innerHTML = '';
        
        if (!favorites || Object.keys(favorites).length === 0) {
            favoritesList.innerHTML = '<div class="list-item">No favorite queries</div>';
            favoriteQueriesList.innerHTML = '<div class="favorite-query">No favorite queries. Save queries by clicking "Save as Favorite".</div>';
            return;
        }
        
        // Update both UI components with favorites
        Object.entries(favorites).forEach(([name, data]) => {
            // For the favorites tab
            const listItem = document.createElement('div');
            listItem.className = 'list-item';
            
            const contentDiv = document.createElement('div');
            contentDiv.style.width = '100%';
            
            const nameDiv = document.createElement('div');
            nameDiv.textContent = name;
            nameDiv.style.fontWeight = 'bold';
            
            const queryDiv = document.createElement('div');
            queryDiv.textContent = data.query.length > 70 ? data.query.substring(0, 70) + '...' : data.query;
            queryDiv.style.fontSize = '11px';
            queryDiv.title = data.query;
            
            // Add native badge if applicable
            if (data.isNative) {
                const badge = document.createElement('span');
                badge.className = 'badge warning';
                badge.textContent = 'SQL';
                badge.style.marginLeft = '5px';
                nameDiv.appendChild(badge);
            }
            
            contentDiv.appendChild(nameDiv);
            contentDiv.appendChild(queryDiv);
            
            // Remove button
            const removeBtn = document.createElement('button');
            removeBtn.className = 'small secondary';
            removeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            removeBtn.title = 'Remove from favorites';
            
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({
                    command: 'removeFavoriteQuery',
                    name
                });
            });
            
            listItem.appendChild(contentDiv);
            listItem.appendChild(removeBtn);
            
            // Click handler to load query and params
            listItem.addEventListener('click', () => {
                document.getElementById('query-input').value = data.query;
                document.getElementById('is-native-checkbox').checked = data.isNative || false;
                setActiveTab('query');
                
                // Load params
                document.getElementById('params-container').innerHTML = '';
                if (data.params) {
                    Object.entries(data.params).forEach(([key, value]) => {
                        addParamField(key, value);
                    });
                } else {
                    // Auto detect params
                    autoDetectedParams = detectQueryParams(data.query);
                    updateParamsUI();
                }
            });
            
            favoritesList.appendChild(listItem);
            
            // For the dropdown in query tab
            const dropdownItem = document.createElement('div');
            dropdownItem.className = 'favorite-query';
            dropdownItem.textContent = name;
            dropdownItem.title = data.query;
            
            // Add native badge if applicable
            if (data.isNative) {
                const badge = document.createElement('span');
                badge.className = 'badge warning';
                badge.textContent = 'SQL';
                badge.style.marginLeft = '5px';
                badge.style.fontSize = '9px';
                dropdownItem.appendChild(badge);
            }
            
            dropdownItem.addEventListener('click', () => {
                document.getElementById('query-input').value = data.query;
                document.getElementById('is-native-checkbox').checked = data.isNative || false;
                
                // Load params
                document.getElementById('params-container').innerHTML = '';
                if (data.params) {
                    Object.entries(data.params).forEach(([key, value]) => {
                        addParamField(key, value);
                    });
                } else {
                    // Auto detect params
                    autoDetectedParams = detectQueryParams(data.query);
                    updateParamsUI();
                }
            });
            
            favoriteQueriesList.appendChild(dropdownItem);
        });
    }
    
    // Update param sets list
    function updateParamSetsUI(paramSets) {
        const container = document.getElementById('param-sets-list');
        container.innerHTML = '';
        
        if (!paramSets || Object.keys(paramSets).length === 0) {
            container.innerHTML = '<div class="list-item">No saved parameter sets</div>';
            return;
        }
        
        Object.entries(paramSets).forEach(([name, params]) => {
            const item = document.createElement('div');
            item.className = 'list-item';
            
            const contentDiv = document.createElement('div');
            contentDiv.style.width = '100%';
            
            const nameDiv = document.createElement('div');
            nameDiv.textContent = name;
            nameDiv.style.fontWeight = 'bold';
            
            const paramsDiv = document.createElement('div');
            const paramKeys = Object.keys(params);
            paramsDiv.textContent = paramKeys.length > 0 
                ? `${paramKeys.slice(0, 3).join(', ')}${paramKeys.length > 3 ? ' ...' : ''}` 
                : 'No parameters';
            paramsDiv.style.fontSize = '11px';
            
            contentDiv.appendChild(nameDiv);
            contentDiv.appendChild(paramsDiv);
            
            // Remove button
            const removeBtn = document.createElement('button');
            removeBtn.className = 'small secondary';
            removeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            removeBtn.title = 'Remove set';
            
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({
                    command: 'removeParamSet',
                    name
                });
            });
            
            item.appendChild(contentDiv);
            item.appendChild(removeBtn);
            
            // Click handler to load parameters
            item.addEventListener('click', () => {
                loadParamSet(name, params);
                setActiveTab('query');
            });
            
            container.appendChild(item);
        });
    }
    
    // Configuration
    document.getElementById('add-package-btn').addEventListener('click', () => {
        addEntityPackage('');
    });
    
    function addEntityPackage(packageName) {
        const container = document.getElementById('entity-packages-container');
        const packageTag = document.createElement('div');
        packageTag.className = 'package-tag';
        
        if (!packageName) {
            // Create input for adding a new package
            packageTag.innerHTML = `
                <input type="text" class="package-input" placeholder="Package name" style="width: 120px;">
                <button class="confirm-package-btn" style="padding: 2px; background: none;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </button>
            `;
            
            container.appendChild(packageTag);
            
            const input = packageTag.querySelector('.package-input');
            input.focus();
            
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const value = input.value.trim();
                    if (value) {
                        packageTag.remove();
                        addEntityPackage(value);
                    }
                } else if (e.key === 'Escape') {
                    packageTag.remove();
                }
            });
            
            packageTag.querySelector('.confirm-package-btn').addEventListener('click', () => {
                const value = input.value.trim();
                if (value) {
                    packageTag.remove();
                    addEntityPackage(value);
                }
            });
        } else {
            // Create a display tag for an existing package
            packageTag.innerHTML = `
                <span>${packageName}</span>
                <button class="remove-package-btn" style="padding: 0; background: none;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            `;
            
            container.appendChild(packageTag);
            
            packageTag.querySelector('.remove-package-btn').addEventListener('click', () => {
                packageTag.remove();
            });
        }
    }
    
    document.getElementById('save-config-btn').addEventListener('click', () => {
        const config = {
            dbConfig: {
                url: document.getElementById('db-url').value,
                username: document.getElementById('db-username').value,
                password: document.getElementById('db-password').value,
                driver: document.getElementById('db-driver').value
            },
            serverHost: document.getElementById('server-host').value,
            serverPort: parseInt(document.getElementById('server-port').value) || 8089,
            logLevel: document.getElementById('log-level').value,
            entityLibPath: document.getElementById('entity-lib-path').value,
            hibernateVersion: document.getElementById('hibernate-version').value,
            projectScan: document.getElementById('project-scan-checkbox').checked
        };
        
        // Get entity packages
        const packageTags = document.querySelectorAll('.package-tag span');
        const entityPackages = [];
        packageTags.forEach(tag => {
            entityPackages.push(tag.textContent);
        });
        config.entityPackages = entityPackages;
        
        vscode.postMessage({
            command: 'saveConfiguration',
            config
        });
    });
    
    // Event listener for the Hibernate version select
    document.getElementById('hibernate-version').addEventListener('change', function(event) {
        const newVersion = event.target.value;
        showNotification('For Hibernate version changes to take effect, please save and restart VS Code!', 'info', 10000);
    });
    
    function updateConfigurationUI(config) {
        if (!config) return;
        
        const dbConfig = config.dbConfig || {};
        document.getElementById('db-url').value = dbConfig.url || '';
        document.getElementById('db-username').value = dbConfig.username || '';
        document.getElementById('db-password').value = dbConfig.password || '';
        document.getElementById('db-driver').value = dbConfig.driver || '';
        
        // Server settings
        document.getElementById('server-host').value = config.serverHost || '127.0.0.1';
        document.getElementById('server-port').value = config.serverPort || 8089;
        document.getElementById('log-level').value = config.logLevel || 'INFO';
        
        document.getElementById('entity-lib-path').value = config.entityLibPath || '';
        document.getElementById('hibernate-version').value = config.hibernateVersion || '5.6.15';
        document.getElementById('project-scan-checkbox').checked = config.projectScan !== undefined ? config.projectScan : true;
        
        // Clear and update entity packages
        document.getElementById('entity-packages-container').innerHTML = '';
        if (config.entityPackages && Array.isArray(config.entityPackages)) {
            config.entityPackages.forEach(pkg => {
                addEntityPackage(pkg);
            });
        }
    }
    
    // Message handler
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Message received in webview:', message.command);
        
        switch (message.command) {
            case 'testQuery':
                document.getElementById('query-input').value = message.query;
                setActiveTab('query');
                
                // Determine if it's likely a native query (SQL)
                const lowerQuery = message.query.toLowerCase();
                const isLikelyNative = 
                    lowerQuery.includes('select ') && 
                    (lowerQuery.includes(' from ') || lowerQuery.includes('\nfrom ')) &&
                    !lowerQuery.includes(':');
                
                document.getElementById('is-native-checkbox').checked = isLikelyNative;
                
                // Detect parameters
                autoDetectedParams = detectQueryParams(message.query);
                updateParamsUI();
                
                // Load saved parameters for this query
                vscode.postMessage({
                    command: 'loadParams',
                    query: message.query
                });
                break;
                
            case 'queryResult':
                // Update UI to show query results
                document.getElementById('result-placeholder').style.display = 'none';
                document.getElementById('result-content').style.display = 'block';
                
                // Save the raw results for copying
                currentResults = message.raw;
                
                // Update info section
                const resultInfo = document.getElementById('result-info');
                resultInfo.innerHTML = `
                    <div class="result-info-item">
                        <span>Status:</span>
                        <span class="badge ${message.status === 'SUCCESS' ? 'success' : 'error'}">${message.status}</span>
                    </div>
                    <div class="result-info-item">
                        <span>Time:</span>
                        <span>${message.executionTime}ms</span>
                    </div>
                    <div class="result-info-item">
                        <span>Results:</span>
                        <span>${message.rowCount}</span>
                    </div>
                    <div class="result-info-item">
                        <span>${message.message}</span>
                    </div>
                `;
                
                // Create results table
                const tableContainer = document.getElementById('result-table-container');
                
                if (message.results && message.results.columns && message.results.columns.length > 0) {
                    // Create table
                    const table = document.createElement('table');
                    table.className = 'result-table';
                    
                    // Create header
                    const thead = document.createElement('thead');
                    const headerRow = document.createElement('tr');
                    
                    message.results.columns.forEach(column => {
                        const th = document.createElement('th');
                        th.textContent = column;
                        headerRow.appendChild(th);
                    });
                    
                    thead.appendChild(headerRow);
                    table.appendChild(thead);
                    
                    // Create body
                    const tbody = document.createElement('tbody');
                    
                    message.results.rows.forEach(row => {
                        const tr = document.createElement('tr');
                        
                        message.results.columns.forEach(column => {
                            const td = document.createElement('td');
                            const value = row[column];
                            
                            // Format value based on type
                            if (value === null || value === undefined) {
                                td.innerHTML = '<em style="opacity: 0.5;">null</em>';
                            } else if (typeof value === 'object') {
                                td.textContent = JSON.stringify(value);
                            } else {
                                td.textContent = value;
                            }
                            
                            tr.appendChild(td);
                        });
                        
                        tbody.appendChild(tr);
                    });
                    
                    table.appendChild(tbody);
                    tableContainer.innerHTML = '';
                    tableContainer.appendChild(table);
                } else {
                    // No results
                    tableContainer.innerHTML = '<p>No results found.</p>';
                }
                break;
                
            case 'queryError':
                // Show error message
                document.getElementById('result-placeholder').style.display = 'none';
                document.getElementById('result-content').style.display = 'block';
                
                const errorInfo = document.getElementById('result-info');
                errorInfo.innerHTML = `
                    <div class="result-info-item">
                        <span>Status:</span>
                        <span class="badge error">ERROR</span>
                    </div>
                `;
                
                const errorContainer = document.getElementById('result-table-container');
                errorContainer.innerHTML = `
                    <div style="color: var(--error-color);">
                        <p><strong>Error:</strong> ${message.error}</p>
                        <pre class="code" style="font-size: 11px;">${message.stack || ''}</pre>
                    </div>
                `;
                break;
                
            case 'queryStatus':
                if (message.status === 'loading') {
                    document.getElementById('result-placeholder').innerHTML = '<div style="display:flex;align-items:center;gap:10px;"><div class="spinner"></div> Executing query...</div>';
                    document.getElementById('result-placeholder').style.display = 'block';
                    document.getElementById('result-content').style.display = 'none';
                }
                break;
                
            case 'formattedQuery':
                document.getElementById('query-input').value = message.query;
                break;
                
            case 'history':
                console.log('Processing received history:', message);
                // Check if the message contains queryHistory or queries (for compatibility)
                queryHistory = message.queryHistory || message.queries || [];
                
                updateHistoryUI(queryHistory);
                break;
                
            case 'params':
                const savedParams = message.params;
                
                // Clear existing params and add saved ones
                document.getElementById('params-container').innerHTML = '';
                
                if (savedParams && Object.keys(savedParams).length > 0) {
                    Object.entries(savedParams).forEach(([key, value]) => {
                        addParamField(key, value);
                    });
                } else {
                    // Fall back to auto-detected params
                    updateParamsUI();
                }
                break;
                
            case 'scannedQueries':
                scannedQueries = message.queries;
                updateScannedQueriesUI(scannedQueries);
                break;
                
            case 'scanResult':
                if (message.success) {
                    showNotification(message.message, 'success');
                    
                    // Update scanned queries list
                    scannedQueries = message.queries;
                    updateScannedQueriesUI(scannedQueries);
                    
                    // Make sure scanned queries tab is active
                    setActiveQueryList('scanned');
                } else {
                    showNotification(message.message, 'error');
                }
                break;
                
            case 'favorites':
                favoriteQueries = message.favorites;
                updateFavoritesUI(favoriteQueries);
                break;
                
            case 'paramSets':
                savedParamSets = message.paramSets;
                updateParamSetsUI(savedParamSets);
                break;
                
            case 'configuration':
                updateConfigurationUI(message.config);
                break;
                
            case 'configurationSaved':
                showNotification(message.message, message.success ? 'success' : 'error');
                break;
                
            case 'configurationError':
                showNotification('Error loading configuration: ' + message.error, 'error');
                break;
                
            case 'notification':
                showNotification(message.message, message.type);
                break;
        }
    });
    
    // Initial loads
    vscode.postMessage({ command: 'loadHistory' });
    vscode.postMessage({ command: 'loadScannedQueries' });
    vscode.postMessage({ command: 'loadFavorites' });
    vscode.postMessage({ command: 'loadParamSets' });
    vscode.postMessage({ command: 'loadConfiguration' });
})();