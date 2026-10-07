const SPREADSHEET_ID = '1IUE9GsCbui3xwFx8rSlUaKUJWOvMboNNSEFAgeU9jZA';
const FOLDER_ID = '1xTylsRK6qEawXBtYfjbCoYpZ_zwAW9lP';
const GOOGLE_CLIENT_ID = '441116312261-fd5ofvrlm4dmad44o38n6c1sms31vq65.apps.googleusercontent.com';
const MONITORING_SHEET_NAME = 'Monitoring';
const ACCESS_SHEET_NAME = 'Access';
const PROJECTS_SHEET_NAME = 'Projects';
const PROJECT_HEADERS = ['Project ID', 'Project Name', 'Owner Email', 'Created At'];
const FRONTEND_ORIGINS = [
  'https://musa9898.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
];
const MONITORING_HEADERS = [
  'record_id', 'project_id', 'record_type', 'item_name', 'status',
  'date', 'reporter', 'notes', 'drive_url', 'payload_json', 'updated_at', 'email'
];

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.bridge === '1') return createBridgeOutput_(params.origin);
  try {
    const identity = verifyGoogleIdToken_(params.idToken);
    const projects = getAuthorizedProjects_(identity.email);
    const requestedProjectId = String(params.projectId || '');
    const allowedProjects = requestedProjectId
      ? projects.filter((project) => project.projectId === requestedProjectId)
      : projects;
    if (!allowedProjects.length) throw new Error('Akun tidak memiliki akses ke proyek ini.');

    const projectIds = new Set(allowedProjects.map((project) => project.projectId));
    const records = readMonitoringRecords_().filter((record) => projectIds.has(record.projectId));
    const snapshots = {};
    const snapshotChunks = {};
    records.forEach((record) => {
      if (record.recordType === 'snapshot_chunk') {
        if (!snapshotChunks[record.projectId]) snapshotChunks[record.projectId] = [];
        snapshotChunks[record.projectId].push({ index: Number(record.status), text: String(record.payload || '') });
      }
    });
    Object.keys(snapshotChunks).forEach((projectId) => {
      const serialized = snapshotChunks[projectId]
        .sort((first, second) => first.index - second.index)
        .map((chunk) => chunk.text)
        .join('');
      snapshots[projectId] = parseJson_(serialized);
    });

    return jsonOutput_({
      status: 'success',
      email: identity.email,
      projects: allowedProjects,
      records,
      snapshots
    });
  } catch (error) {
    return jsonOutput_({ status: 'error', message: error.message || 'Gagal membaca data.' });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const request = JSON.parse(e?.postData?.contents || '{}');
    const identity = verifyGoogleIdToken_(request.idToken);
    if (request.action === 'createProject') {
      lock.waitLock(20000);
      return jsonOutput_({
        status: 'success',
        project: createProjectForUser_(request.projectName, identity.email)
      });
    }

    const projectId = String(request.projectId || '');
    const project = getAuthorizedProjects_(identity.email).find((entry) => entry.projectId === projectId);
    if (!project) throw new Error('Akun tidak memiliki akses ke proyek ini.');

    if (request.action === 'uploadFile') {
      lock.waitLock(20000);
      return jsonOutput_({
        status: 'success',
        file: saveDriveFile_(project, request.file, identity.email)
      });
    }
    if (request.action === 'deleteFile') {
      lock.waitLock(20000);
      deleteDriveFile_(projectId, String(request.fileId || ''));
      return jsonOutput_({ status: 'success' });
    }
    if (request.action !== 'saveSnapshot' || !request.snapshot || typeof request.snapshot !== 'object') {
      throw new Error('Payload penyimpanan tidak valid.');
    }

    lock.waitLock(20000);
    const uploadedFiles = [];
    const cleanSnapshot = replaceBase64Images_(request.snapshot, projectId, uploadedFiles);
    const records = buildMonitoringRecords_(project, cleanSnapshot, identity.email, uploadedFiles);
    replaceProjectRecords_(projectId, records);

    return jsonOutput_({
      status: 'success',
      fileUrl: uploadedFiles[0]?.url || '',
      snapshot: cleanSnapshot,
      records
    });
  } catch (error) {
    return jsonOutput_({ status: 'error', message: error.message || 'Gagal menyimpan data.' });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function handleBridgeRequest(request) {
  try {
    const output = request.action === 'load'
      ? doGet({ parameter: request })
      : doPost({ postData: { contents: JSON.stringify(request) } });
    return JSON.parse(output.getContent());
  } catch (error) {
    return { status: 'error', message: error.message || 'Permintaan Apps Script gagal.' };
  }
}

function createBridgeOutput_(parentOrigin) {
  if (FRONTEND_ORIGINS.indexOf(String(parentOrigin || '')) < 0) {
    return HtmlService.createHtmlOutput('Origin tidak diizinkan.');
  }
  const allowedOrigins = JSON.stringify(FRONTEND_ORIGINS);
  const initialOrigin = JSON.stringify(parentOrigin);
  const html = `<!doctype html><html><head><base target="_top"></head><body><script>
    const allowedOrigins = ${allowedOrigins};
    const initialOrigin = ${initialOrigin};
    window.addEventListener('message', function(event) {
      if (event.source !== window.top || allowedOrigins.indexOf(event.origin) < 0) return;
      const message = event.data || {};
      if (message.type !== 'request' || !message.requestId || !message.request) return;
      google.script.run
        .withSuccessHandler(function(result) {
          window.top.postMessage({ type: 'response', requestId: message.requestId, result: result }, event.origin);
        })
        .withFailureHandler(function(error) {
          window.top.postMessage({ type: 'response', requestId: message.requestId, error: error.message || 'Permintaan gagal.' }, event.origin);
        })
        .handleBridgeRequest(message.request);
    });
    window.top.postMessage({ type: 'apps-script-bridge-ready' }, initialOrigin);
  </script></body></html>`;
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifyGoogleIdToken_(idToken) {
  if (!idToken) throw new Error('Sesi Google tidak ditemukan. Silakan masuk kembali.');
  if (GOOGLE_CLIENT_ID.indexOf('PASTE_') === 0) throw new Error('GOOGLE_CLIENT_ID belum dikonfigurasi di Code.gs.');

  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) throw new Error('Token Google tidak valid atau sudah kedaluwarsa.');

  const claims = JSON.parse(response.getContentText());
  const expiresAt = Number(claims.exp || 0) * 1000;
  if (claims.aud !== GOOGLE_CLIENT_ID || expiresAt <= Date.now() || String(claims.email_verified) !== 'true') {
    throw new Error('Identitas Google tidak valid.');
  }
  return {
    sub: String(claims.sub || ''),
    email: String(claims.email || '').trim().toLowerCase(),
    name: String(claims.name || claims.email || '')
  };
}

function getAuthorizedProjects_(email) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(ACCESS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Daftar undangan belum disiapkan di tab Access.');

  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map((value) => String(value).trim().toLowerCase());
  const emailIndex = headers.indexOf('email');
  const projectIdIndex = headers.indexOf('project_id');
  const projectNameIndex = headers.indexOf('project_name');
  const roleIndex = headers.indexOf('role');
  const activeIndex = headers.indexOf('active');
  if ([emailIndex, projectIdIndex, projectNameIndex, roleIndex, activeIndex].some((index) => index < 0)) {
    throw new Error('Header tab Access harus berisi email, project_id, project_name, role, active.');
  }

  return values.slice(1)
    .filter((row) => String(row[emailIndex]).trim().toLowerCase() === email
      && ['true', 'yes', 'active', '1'].includes(String(row[activeIndex]).trim().toLowerCase()))
    .map((row) => ({
      projectId: String(row[projectIdIndex]).trim(),
      projectName: String(row[projectNameIndex]).trim(),
      role: String(row[roleIndex]).trim()
    }))
    .filter((project) => project.projectId && project.projectName);
}

function createProjectForUser_(projectName, email) {
  const name = String(projectName || '').trim();
  if (!name) throw new Error('Nama proyek wajib diisi.');
  if (name.length > 100) throw new Error('Nama proyek maksimal 100 karakter.');

  const currentProjects = getAuthorizedProjects_(email);
  if (!currentProjects.some((project) => ['admin', 'owner'].includes(project.role.toLowerCase()))) {
    throw new Error('Hanya admin atau owner proyek yang dapat menambahkan proyek.');
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const accessSheet = spreadsheet.getSheetByName(ACCESS_SHEET_NAME);
  const accessValues = accessSheet.getDataRange().getDisplayValues();
  const accessHeaders = accessValues[0].map((value) => String(value).trim().toLowerCase());
  const accessIndexes = {
    email: accessHeaders.indexOf('email'),
    projectId: accessHeaders.indexOf('project_id'),
    projectName: accessHeaders.indexOf('project_name'),
    role: accessHeaders.indexOf('role'),
    active: accessHeaders.indexOf('active')
  };

  let projectsSheet = spreadsheet.getSheetByName(PROJECTS_SHEET_NAME);
  if (!projectsSheet) projectsSheet = spreadsheet.insertSheet(PROJECTS_SHEET_NAME);
  if (projectsSheet.getLastRow() === 0) projectsSheet.appendRow(PROJECT_HEADERS);
  const projectValues = projectsSheet.getDataRange().getDisplayValues();
  const projectHeaders = projectValues[0].map((value) => String(value).trim().toLowerCase());
  const projectIndexes = {
    id: projectHeaders.indexOf('project id'),
    name: projectHeaders.indexOf('project name'),
    owner: projectHeaders.indexOf('owner email'),
    createdAt: projectHeaders.indexOf('created at')
  };
  if (Object.values(projectIndexes).some((index) => index < 0)) {
    throw new Error('Header tab Projects harus berisi Project ID, Project Name, Owner Email, Created At.');
  }

  const normalizedName = name.toLocaleLowerCase('id-ID');
  const duplicateInProjects = projectValues.slice(1)
    .some((row) => String(row[projectIndexes.name]).trim().toLocaleLowerCase('id-ID') === normalizedName);
  const duplicateInAccess = accessValues.slice(1)
    .some((row) => String(row[accessIndexes.projectName]).trim().toLocaleLowerCase('id-ID') === normalizedName);
  if (duplicateInProjects || duplicateInAccess) throw new Error('Nama proyek tersebut sudah digunakan.');

  const existingIds = new Set([
    ...projectValues.slice(1).map((row) => String(row[projectIndexes.id]).trim()),
    ...accessValues.slice(1).map((row) => String(row[accessIndexes.projectId]).trim())
  ].filter(Boolean));
  const baseId = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'proyek';
  let projectId = baseId;
  let suffix = 2;
  while (existingIds.has(projectId)) projectId = `${baseId}-${suffix++}`;

  const projectRow = Array(projectsSheet.getLastColumn()).fill('');
  projectRow[projectIndexes.id] = projectId;
  projectRow[projectIndexes.name] = name;
  projectRow[projectIndexes.owner] = email;
  projectRow[projectIndexes.createdAt] = new Date().toISOString();

  const accessRow = Array(accessSheet.getLastColumn()).fill('');
  accessRow[accessIndexes.email] = email;
  accessRow[accessIndexes.projectId] = projectId;
  accessRow[accessIndexes.projectName] = name;
  accessRow[accessIndexes.role] = 'admin';
  accessRow[accessIndexes.active] = true;

  const projectRowIndex = projectsSheet.getLastRow() + 1;
  projectsSheet.appendRow(projectRow);
  try {
    accessSheet.appendRow(accessRow);
  } catch (error) {
    projectsSheet.deleteRow(projectRowIndex);
    throw error;
  }

  return { projectId: projectId, projectName: name, role: 'admin' };
}

function getMonitoringSheet_() {
  if (SPREADSHEET_ID.indexOf('PASTE_') === 0) throw new Error('SPREADSHEET_ID belum dikonfigurasi di Code.gs.');
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(MONITORING_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(MONITORING_SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(MONITORING_HEADERS);
  return sheet;
}

function readMonitoringRecords_() {
  const sheet = getMonitoringSheet_();
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, MONITORING_HEADERS.length).getValues()
    .filter((row) => row[0])
    .map((row) => ({
      recordId: String(row[0]),
      projectId: String(row[1]),
      recordType: String(row[2]),
      itemName: String(row[3]),
      status: String(row[4]),
      date: String(row[5]),
      reporter: String(row[6]),
      notes: String(row[7]),
      driveUrl: String(row[8]),
      payload: parseJson_(row[9]),
      updatedAt: String(row[10]),
      email: String(row[11])
    }));
}

function replaceBase64Images_(value, projectId, uploadedFiles, key) {
  if (typeof value === 'string') {
    const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
    if (!match) return value;
    const mimeType = match[1];
    const extension = mimeType.split('/')[1].replace('jpeg', 'jpg');
    const fileName = 'mep_' + safeFileName_(projectId) + '_' + Date.now() + '_' + Utilities.getUuid() + '.' + extension;
    const bytes = Utilities.base64Decode(match[2]);
    const blob = Utilities.newBlob(bytes, mimeType, fileName);
    const file = DriveApp.getFolderById(FOLDER_ID).createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = file.getUrl();
    uploadedFiles.push({ id: file.getId(), name: fileName, url: url });
    return url;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => replaceBase64Images_(entry, projectId, uploadedFiles, key));
  }
  if (value && typeof value === 'object') {
    const result = {};
    Object.keys(value).forEach((property) => {
      result[property] = replaceBase64Images_(value[property], projectId, uploadedFiles, property);
    });
    return result;
  }
  return value;
}

function buildMonitoringRecords_(project, snapshot, email, uploadedFiles) {
  const now = new Date().toISOString();
  const serializedSnapshot = JSON.stringify(snapshot);
  const chunks = serializedSnapshot.match(/[\s\S]{1,30000}/g) || ['{}'];
  const records = chunks.map((chunk, index) => ({
    recordId: 'snapshot:' + project.projectId + ':' + index,
    projectId: project.projectId,
    recordType: 'snapshot_chunk',
    itemName: 'Project snapshot',
    status: String(index),
    date: now,
    reporter: email,
    notes: 'Snapshot chunk ' + (index + 1) + '/' + chunks.length,
    driveUrl: uploadedFiles[0]?.url || '',
    payload: chunk,
    updatedAt: now,
    email: email
  }));

  (snapshot.checklistItems || []).forEach((item) => {
    records.push({
      recordId: 'checklist:' + item.id,
      projectId: project.projectId,
      recordType: 'checklist',
      itemName: item.work || item.item || '',
      status: item.status || '',
      date: item.date || '',
      reporter: item.supervisor || email,
      notes: [item.note, item.testingNote].filter(Boolean).join(' | '),
      driveUrl: firstPhotoUrl_(item.photos || item.photo),
      payload: item,
      updatedAt: now,
      email: email
    });
  });

  (snapshot.materialItems || []).forEach((item) => {
    const deliveryHistory = snapshot.deliveryHistory?.[item.name] || [];
    records.push({
      recordId: 'material:' + item.name,
      projectId: project.projectId,
      recordType: 'material',
      itemName: item.name || '',
      status: Number(item.received || 0) - Number(item.issued || 0) > 0 ? 'Tersedia' : 'Habis',
      date: now,
      reporter: email,
      notes: 'Stok: ' + (item.received || 0) + ' ' + (item.unit || '') + '; keluar: ' + (item.issued || 0),
      driveUrl: firstPhotoUrl_(deliveryHistory.map((delivery) => delivery.photo)),
      payload: item,
      updatedAt: now,
      email: email
    });
  });

  (snapshot.assetItems || []).forEach((item) => {
    records.push({
      recordId: 'asset:' + item.id,
      projectId: project.projectId,
      recordType: 'asset',
      itemName: item.name || '',
      status: item.status || '',
      date: item.updatedAt || now,
      reporter: email,
      notes: [item.code ? 'Kode: ' + item.code : '', item.location || ''].filter(Boolean).join(' | '),
      driveUrl: firstPhotoUrl_(item.photo),
      payload: item,
      updatedAt: item.updatedAt || now,
      email: email
    });
  });
  return records;
}

function firstPhotoUrl_(photos) {
  const list = Array.isArray(photos) ? photos : (photos ? [photos] : []);
  return list.find((photo) => typeof photo === 'string' && /^https:\/\//i.test(photo)) || '';
}

function replaceProjectRecords_(projectId, records) {
  const sheet = getMonitoringSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existing = sheet.getRange(2, 2, lastRow - 1, 2).getDisplayValues();
    for (let index = existing.length - 1; index >= 0; index--) {
      if (String(existing[index][0]) === projectId && String(existing[index][1]) !== 'file') {
        sheet.deleteRow(index + 2);
      }
    }
  }
  if (!records.length) return;
  const rows = records.map((record) => [
    record.recordId,
    record.projectId,
    record.recordType,
    record.itemName,
    record.status,
    record.date,
    record.reporter,
    record.notes,
    record.driveUrl,
    JSON.stringify(record.payload),
    record.updatedAt,
    record.email
  ]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, MONITORING_HEADERS.length).setValues(rows);
}

function saveDriveFile_(project, fileData, email) {
  if (!fileData || typeof fileData.base64 !== 'string') throw new Error('Data file tidak valid.');
  const match = fileData.base64.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) throw new Error('File harus dikirim sebagai data URL Base64.');

  const mimeType = match[1];
  const extension = String(fileData.name || '').split('.').pop().toLowerCase();
  if (!['pdf', 'dxf', 'jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
    throw new Error('Jenis file tidak diizinkan.');
  }
  const name = 'mep_' + safeFileName_(project.projectId) + '_' + Date.now() + '_' + safeFileName_(fileData.name);
  const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), mimeType, name);
  const driveFile = DriveApp.getFolderById(FOLDER_ID).createFile(blob);
  driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const file = {
    id: driveFile.getId(),
    projectId: project.projectId,
    folderId: String(fileData.folderId || ''),
    name: String(fileData.name || name),
    type: mimeType,
    size: driveFile.getSize(),
    addedAt: new Date().toISOString(),
    driveUrl: driveFile.getUrl()
  };
  appendMonitoringRecord_({
    recordId: 'file:' + file.id,
    projectId: project.projectId,
    recordType: 'file',
    itemName: file.name,
    status: 'UPLOADED',
    date: file.addedAt,
    reporter: email,
    notes: 'Drive file',
    driveUrl: file.driveUrl,
    payload: file,
    updatedAt: file.addedAt,
    email: email
  });
  return file;
}

function appendMonitoringRecord_(record) {
  getMonitoringSheet_().appendRow([
    record.recordId, record.projectId, record.recordType, record.itemName,
    record.status, record.date, record.reporter, record.notes, record.driveUrl,
    JSON.stringify(record.payload), record.updatedAt, record.email
  ]);
}

function deleteDriveFile_(projectId, fileId) {
  if (!fileId) throw new Error('ID file wajib diisi.');
  const sheet = getMonitoringSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('File tidak ditemukan.');
  const rows = sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues();
  const rowIndex = rows.findIndex((row) => row[0] === 'file:' + fileId && row[1] === projectId && row[2] === 'file');
  if (rowIndex < 0) throw new Error('File tidak ditemukan pada proyek ini.');
  DriveApp.getFileById(fileId).setTrashed(true);
  sheet.deleteRow(rowIndex + 2);
}

function parseJson_(value) {
  try {
    return JSON.parse(value || 'null');
  } catch (error) {
    return null;
  }
}

function safeFileName_(value) {
  return String(value || 'project').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
}
