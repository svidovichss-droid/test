const CACHE_NAME = 'progress-calculator-v2.3';
const CACHE_URLS = [
    '/data.json',
    '/fallback.json',
    '/index.html',
    '/script.js',
    '/styles.css',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://raw.githubusercontent.com/svidovichss-droid/ProgressSAP.github.io/main/data.json'
];

// Очередь для хранения запросов, которые не удалось выполнить
const backgroundSyncQueue = [];

// Установка Service Worker
self.addEventListener('install', (event) => {
    console.log('Service Worker: Установка');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Кэширование файлов');
                return cache.addAll(CACHE_URLS);
            })
            .then(() => self.skipWaiting())
    );
});

// Активация Service Worker
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Активация');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('Service Worker: Очистка старого кэша');
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Перехват запросов
self.addEventListener('fetch', (event) => {
    // Игнорируем запросы к Google Analytics и другим внешним сервисам
    if (event.request.url.includes('google-analytics') || 
        event.request.url.includes('gtag')) {
        return;
    }

    // Для JSON данных используем стратегию "Сначала сеть, потом кэш"
    if (event.request.url.includes('data.json')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Клонируем ответ, так как он может быть использован только один раз
                    const responseClone = response.clone();
                    
                    // Сохраняем свежие данные в кэш
                    caches.open(CACHE_NAME)
                        .then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    
                    return response;
                })
                .catch(() => {
                    // Если сеть недоступна, используем кэшированные данные
                    return caches.match(event.request)
                        .then((cachedResponse) => {
                            if (cachedResponse) {
                                return cachedResponse;
                            }
                            // Если нет кэшированных данных, возвращаем fallback
                            return new Response(JSON.stringify([
                                {
                                    "Код продукции": "000001",
                                    "Полное наименование (русское)": "Тестовый продукт 1",
                                    "Срок годности": 365,
                                    "Штук в упаковке": 10,
                                    "Штрихкод упаковки": "1234567890123",
                                    "Производитель": "Тестовый производитель",
                                    "Название стандарта": "ГОСТ 12345-2020"
                                }
                            ]), {
                                headers: { 'Content-Type': 'application/json' }
                            });
                        });
                })
        );
        return;
    }

    // Для остальных файлов используем стратегию "Сначала кэш, потом сеть"
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Возвращаем кэшированную версию или делаем запрос к сети
                return response || fetch(event.request);
            })
    );
});

// Фоновая синхронизация
self.addEventListener('sync', (event) => {
    if (event.tag === 'background-sync') {
        console.log('Service Worker: Фоновая синхронизация запущена');
        event.waitUntil(
            processBackgroundSyncQueue()
                .then(() => {
                    console.log('Service Worker: Фоновая синхронизация завершена успешно');
                    // Уведомляем все клиенты об успешной синхронизации
                    return self.clients.matchAll().then((clients) => {
                        clients.forEach((client) => {
                            client.postMessage({
                                type: 'SYNC_COMPLETE',
                                success: true,
                                message: 'Данные успешно синхронизированы в фоновом режиме'
                            });
                        });
                    });
                })
                .catch((error) => {
                    console.error('Service Worker: Ошибка фоновой синхронизации:', error);
                    // Уведомляем клиенты об ошибке
                    return self.clients.matchAll().then((clients) => {
                        clients.forEach((client) => {
                            client.postMessage({
                                type: 'SYNC_COMPLETE',
                                success: false,
                                message: 'Ошибка при синхронизации данных'
                            });
                        });
                    });
                })
        );
    }
});

// Периодическая синхронизация (если поддерживается)
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'periodic-data-update') {
        console.log('Service Worker: Периодическое обновление данных');
        event.waitUntil(
            updateCachedData()
                .then(() => {
                    console.log('Service Worker: Периодическое обновление данных завершено');
                    return self.clients.matchAll().then((clients) => {
                        clients.forEach((client) => {
                            client.postMessage({
                                type: 'DATA_UPDATED',
                                message: 'Данные обновлены в фоновом режиме'
                            });
                        });
                    });
                })
                .catch((error) => {
                    console.error('Service Worker: Ошибка при периодическом обновлении:', error);
                })
        );
    }
});

// Функция для обработки очереди фоновой синхронизации
function processBackgroundSyncQueue() {
    console.log('Service Worker: Обработка очереди синхронизации');
    
    // Если очередь пуста, просто обновляем кэшированные данные
    if (backgroundSyncQueue.length === 0) {
        return updateCachedData();
    }
    
    // Обрабатываем все элементы в очереди
    const syncPromises = backgroundSyncQueue.map((requestData) => {
        return fetch(requestData.url, {
            method: requestData.method || 'GET',
            headers: requestData.headers || {},
            body: requestData.body
        })
        .then((response) => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response;
        })
        .then(() => {
            // Удаляем успешно обработанный запрос из очереди
            const index = backgroundSyncQueue.indexOf(requestData);
            if (index > -1) {
                backgroundSyncQueue.splice(index, 1);
            }
        });
    });
    
    return Promise.all(syncPromises).then(() => {
        // После обработки очереди также обновляем кэшированные данные
        return updateCachedData();
    });
}

// Функция для обновления кэшированных данных
function updateCachedData() {
    console.log('Service Worker: Обновление кэшированных данных');
    
    return caches.open(CACHE_NAME)
        .then((cache) => {
            const updatePromises = CACHE_URLS.map((url) => {
                return fetch(url, { cache: 'no-cache' })
                    .then((response) => {
                        if (response.ok) {
                            return cache.put(url, response);
                        }
                        console.warn(`Service Worker: Не удалось обновить ${url}`);
                        return Promise.resolve();
                    })
                    .catch((error) => {
                        console.error(`Service Worker: Ошибка при обновлении ${url}:`, error);
                        return Promise.resolve();
                    });
            });
            
            return Promise.all(updatePromises);
        });
}

// Функция для добавления запроса в очередь синхронизации
function addToSyncQueue(requestData) {
    backgroundSyncQueue.push(requestData);
    console.log('Service Worker: Запрос добавлен в очередь синхронизации');
}

// Обработка сообщений от клиентов
self.addEventListener('message', (event) => {
    console.log('Service Worker: Получено сообщение от клиента', event.data);
    
    if (event.data && event.data.type === 'SYNC_REQUEST') {
        // Добавляем запрос в очередь синхронизации
        if (event.data.request) {
            addToSyncQueue(event.data.request);
        }
        
        // Запрашиваем фоновую синхронизацию
        if ('sync' in self.registration) {
            self.registration.sync.register('background-sync')
                .then(() => {
                    console.log('Service Worker: Фоновая синхронизация зарегистрирована');
                    event.ports[0].postMessage({
                        success: true,
                        message: 'Синхронизация будет выполнена при восстановлении соединения'
                    });
                })
                .catch((error) => {
                    console.error('Service Worker: Ошибка регистрации синхронизации:', error);
                    event.ports[0].postMessage({
                        success: false,
                        message: 'Ошибка при планировании синхронизации'
                    });
                });
        } else {
            // Если фоновая синхронизация не поддерживается, выполняем сразу
            console.log('Service Worker: Фоновая синхронизация не поддерживается, выполняется немедленно');
            processBackgroundSyncQueue()
                .then(() => {
                    event.ports[0].postMessage({
                        success: true,
                        message: 'Данные синхронизированы'
                    });
                })
                .catch((error) => {
                    event.ports[0].postMessage({
                        success: false,
                        message: 'Ошибка при синхронизации'
                    });
                });
        }
    }
    
    if (event.data && event.data.type === 'UPDATE_CACHE') {
        // Немедленное обновление кэша по запросу клиента
        updateCachedData()
            .then(() => {
                event.ports[0].postMessage({
                    success: true,
                    message: 'Кэш обновлен'
                });
            })
            .catch((error) => {
                event.ports[0].postMessage({
                    success: false,
                    message: 'Ошибка при обновлении кэша'
                });
            });
    }
});
