const express = require('express');
const WebSocket = require('ws');

const app = express();
app.use(express.json());

const PORT = 3000;

// Хранение информации об агентах и сервисах
let agents = {};
let services = {};
let desiredReplicaCount = 3;

// Обработка входящих сообщений от агентов через WebSocket
function setupWebSocketServer() {
  const wss = new WebSocket.Server({ port: 8080 });

  wss.on('connection', (ws, req) => {
    const agentId = req.headers['agent-id'] || `agent-${Math.floor(Math.random() * 1000)}`;

    ws.on('message', (message) => {
      const data = JSON.parse(message);
      handleAgentMessage(agentId, data);
    });

    ws.on('close', () => {
      console.log(`Агент ${agentId} отключился`);
      delete agents[agentId];

      // Удаляем все сервисы, связанные с этим агентом
      for (const serviceId in services) {
        if (services[serviceId].agentId === agentId) {
          console.log(`Сервис ${serviceId} на агенте ${agentId} потерян`);
          delete services[serviceId];
        }
      }

      // Пытаемся восстановить желаемое количество реплик
      reconcileServices();
    });

    agents[agentId] = { ws, status: 'connected' };
    console.log(`Агент ${agentId} подключился`);
  });
}

// Обработка сообщений от агентов
function handleAgentMessage(agentId, data) {
  if (data.type === 'serviceStatus') {
    services[data.serviceId] = {
      agentId,
      ...data.status,
    };
  } else if (data.type === 'agentStatus') {
    updateAgentStatus(agentId, data.status);
  }
}

// Обновление состояния агентов
function updateAgentStatus(agentId, status) {
  if (agents[agentId]) {
    agents[agentId].status = status;
  }
}

// Функция для управления количеством реплик
async function reconcileServices() {
  const currentReplicaCount = Object.keys(services).length;
  if (currentReplicaCount < desiredReplicaCount) {
    // Нужно запустить дополнительные реплики
    const replicasToStart = desiredReplicaCount - currentReplicaCount;
    for (let i = 0; i < replicasToStart; i++) {
      await startService();
    }
  } else if (currentReplicaCount > desiredReplicaCount) {
    // Нужно остановить лишние реплики
    const replicasToStop = currentReplicaCount - desiredReplicaCount;
    for (let i = 0; i < replicasToStop; i++) {
      await stopService();
    }
  }
}

// Функция для запуска сервиса на агенте с наименьшей нагрузкой
async function startService() {
  const agentId = getLeastLoadedAgent();
  if (agentId && agents[agentId]) {
    agents[agentId].ws.send(JSON.stringify({ action: 'startService' }));
    console.log(`Запрос на запуск сервиса отправлен агенту ${agentId}`);
  } else {
    console.log('Нет доступных агентов для запуска сервиса');
  }
}

// Функция для остановки сервиса
async function stopService() {
  const serviceIds = Object.keys(services);
  if (serviceIds.length > 0) {
    const serviceId = serviceIds[0];
    const agentId = services[serviceId].agentId;
    if (agents[agentId]) {
      agents[agentId].ws.send(
        JSON.stringify({ action: 'stopService', serviceId })
      );
      delete services[serviceId];
      console.log(`Запрос на остановку сервиса ${serviceId} отправлен агенту ${agentId}`);
    } else {
      // Агент недоступен, удаляем сервис из списка
      console.log(`Агент ${agentId} недоступен, удаляем сервис ${serviceId}`);
      delete services[serviceId];
    }
  }
}

// Получение агента с наименьшей нагрузкой
function getLeastLoadedAgent() {
  const agentIds = Object.keys(agents);
  if (agentIds.length === 0) return null;

  agentIds.sort((a, b) => {
    const loadA = getAgentLoad(a);
    const loadB = getAgentLoad(b);
    return loadA - loadB;
  });

  return agentIds[0];
}

// Получение нагрузки агента (количество запущенных сервисов)
function getAgentLoad(agentId) {
  let load = 0;
  for (const serviceId in services) {
    if (services[serviceId].agentId === agentId) {
      load++;
    }
  }
  return load;
}

// Эндпоинт для получения статуса кластера
app.get('/status', (req, res) => {
  res.json({
    agents: Object.keys(agents).map((id) => ({
      id,
      status: agents[id].status,
    })),
    services,
    desiredReplicaCount,
  });
});

// Эндпоинт для увеличения количества реплик
app.post('/scale-up', (req, res) => {
  const { count } = req.body;
  desiredReplicaCount += count;
  reconcileServices();
  res.json({ message: 'Масштабирование увеличено' });
});

// Эндпоинт для уменьшения количества реплик
app.post('/scale-down', (req, res) => {
  const { count } = req.body;
  desiredReplicaCount = Math.max(desiredReplicaCount - count, 0);
  reconcileServices();
  res.json({ message: 'Масштабирование уменьшено' });
});

// Запуск сервера и WebSocket
app.listen(PORT, () => {
  console.log(`Сервис-контроллер запущен на порту ${PORT}`);
  setupWebSocketServer();
});

// Периодическое восстановление желаемого состояния
setInterval(reconcileServices, 5000);
