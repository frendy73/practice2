const { Command } = require('commander');
const WebSocket = require('ws');
const { spawn } = require('child_process');

const program = new Command();

// Определение параметров командной строки
program
  .option('-i, --id <type>', 'Идентификатор агента')
  .option('-u, --url <type>', 'URL сервис-контроллера', 'ws://localhost:8080');

program.parse(process.argv);

const options = program.opts();

const CONTROLLER_WS_URL = options.url;
const AGENT_ID = options.id || `agent-${Math.floor(Math.random() * 1000)}`;

// Хранение запущенных сервисов
let services = {};
let serviceIdCounter = 1;

// Подключение к сервис-контроллеру
const ws = new WebSocket(CONTROLLER_WS_URL, {
  headers: {
    'Agent-ID': AGENT_ID,
  },
});

ws.on('open', () => {
  console.log(`Агент ${AGENT_ID} подключен к сервис-контроллеру`);
  sendAgentStatus('connected');
});

ws.on('message', (message) => {
  const data = JSON.parse(message);
  handleControllerMessage(data);
});

ws.on('close', () => {
  console.log(`Соединение агента ${AGENT_ID} с контроллером закрыто`);
});

ws.on('error', (error) => {
  console.error(`Ошибка соединения агента ${AGENT_ID} с контроллером:`, error);
});

// Обработка сообщений от контроллера
function handleControllerMessage(data) {
  if (data.action === 'startService') {
    startService();
  } else if (data.action === 'stopService') {
    stopService(data.serviceId);
  }
}

// Запуск сервиса полезной нагрузки
function startService() {
  const serviceId = `${AGENT_ID}-service-${serviceIdCounter++}`;
  const startTime = new Date();

  const serviceProcess = spawn('node', ['payload-service.js']);

  services[serviceId] = {
    startTime,
    process: serviceProcess,
  };

  console.log(`Сервис ${serviceId} запущен на агенте ${AGENT_ID}`);

  // Отправляем статус сервиса контроллеру
  sendServiceStatus(serviceId);

  // Обработка завершения процесса
  serviceProcess.on('exit', (code) => {
    console.log(`Сервис ${serviceId} завершился с кодом ${code}`);
    delete services[serviceId];
    sendServiceStatus(serviceId, true);
  });
}

// Остановка сервиса
function stopService(serviceId) {
  if (services[serviceId]) {
    services[serviceId].process.kill();
    delete services[serviceId];
    console.log(`Сервис ${serviceId} остановлен на агенте ${AGENT_ID}`);
    // Уведомляем контроллер об остановке сервиса
    sendServiceStatus(serviceId, true);
  }
}

// Отправка статуса сервиса контроллеру
function sendServiceStatus(serviceId, stopped = false) {
  ws.send(
    JSON.stringify({
      type: 'serviceStatus',
      serviceId,
      status: stopped
        ? { status: 'stopped' }
        : { status: 'running', startTime: services[serviceId].startTime },
    })
  );
}

// Отправка статуса агента контроллеру
function sendAgentStatus(status) {
  ws.send(JSON.stringify({ type: 'agentStatus', status, agentId: AGENT_ID }));
}

// Периодически отправляем статус сервисов
setInterval(() => {
  for (const serviceId in services) {
    sendServiceStatus(serviceId);
  }
}, 5000);
