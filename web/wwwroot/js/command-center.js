(() => {
  'use strict';

  const root = document.getElementById('command-center');
  if (!root) {
    return;
  }

  // --- command form: show only the fields relevant to the selected type ----
  const commandType = document.getElementById('commandType');
  const commandFields = Array.from(document.querySelectorAll('[data-command-field]'));

  function syncCommandFields() {
    if (!commandType) {
      return;
    }
    commandFields.forEach((field) => {
      field.hidden = field.dataset.commandField !== commandType.value;
    });
  }

  commandType?.addEventListener('change', syncCommandFields);
  syncCommandFields();

  // --- tracker form: show credentials for the selected tracker type -------
  const trackerType = document.getElementById('trackerType');
  const credentialSections = Array.from(document.querySelectorAll('[data-tracker-type]'));

  function syncTrackerFields() {
    if (!trackerType) {
      return;
    }
    credentialSections.forEach((section) => {
      section.hidden = section.dataset.trackerType !== trackerType.value;
    });
  }

  trackerType?.addEventListener('change', syncTrackerFields);
  syncTrackerFields();

  // --- confirmation for destructive forms --------------------------------
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm)) {
        event.preventDefault();
      }
    });
  });

  // --- real-time command acknowledgements --------------------------------
  const hubUrl = root.dataset.hubUrl;
  const selectedDevice = root.dataset.selectedDevice;
  if (!hubUrl || !selectedDevice || typeof signalR === 'undefined') {
    return;
  }

  const connection = new signalR.HubConnectionBuilder()
    .withUrl(hubUrl)
    .withAutomaticReconnect([0, 2000, 5000, 10000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  connection.on('CommandAcked', (payload) => {
    const row = document.querySelector(`tr[data-command-id="${window.CSS.escape(payload.command_id)}"]`);
    if (!row) {
      return;
    }
    const status = row.querySelector('.js-command-status');
    if (status) {
      status.textContent = payload.status;
      status.className = `badge status-command status-command-${String(payload.status).toLowerCase()} js-command-status`;
    }
    const ack = row.querySelector('.js-command-ack');
    if (ack && payload.acknowledged_at_utc) {
      ack.textContent = new Date(payload.acknowledged_at_utc).toLocaleTimeString('pt-BR');
    }
    row.classList.add('row-acked');
  });

  (async () => {
    try {
      await connection.start();
      await connection.invoke('JoinVehicle', selectedDevice);
    } catch (error) {
      console.warn('SignalR connection failed on the command center', error);
    }
  })();
})();
