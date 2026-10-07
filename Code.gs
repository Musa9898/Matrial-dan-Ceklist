const SPREADSHEET_ID = '1IUE9GsCbui3xwFx8rSlUaKUJWOvMboNNSEFAgeU9jZA';
const FOLDER_ID = '1xTylsRK6qEawXBtYfjbCoYpZ_zwAW9lP';
const GOOGLE_CLIENT_ID = '441116312261-fd5ofvrlm4dmad44o38n6c1sms31vq65.apps.googleusercontent.com';
const MONITORING_SHEET_NAME = 'Monitoring';
const PROJECT_DATA_SHEET_NAME = 'ProjectData';
const ACCESS_SHEET_NAME = 'Access';
const PROJECTS_SHEET_NAME = 'Projects';
const MATERIALS_SHEET_NAME = 'Materials';
const ASSETS_SHEET_NAME = 'Assets';
const CHECKLISTS_SHEET_NAME = 'Checklists';
const DAILY_REPORTS_SHEET_NAME = 'DailyReports';
const PROJECT_FILES_SHEET_NAME = 'ProjectFiles';
const PROJECT_FOLDERS_SHEET_NAME = 'ProjectFolders';
const PROJECT_HEADERS = ['Project ID', 'Project Name', 'Owner Email', 'Created At'];
const PROJECT_DATA_HEADERS = ['Project ID', 'Snapshot JSON', 'Updated By', 'Updated At', 'Chunk Index'];
const MATERIAL_HEADERS = [
  'record_id', 'project_id', 'material_name', 'unit', 'qty_received', 'qty_issued',
  'qty_balance', 'target', 'status', 'date', 'reporter', 'notes', 'drive_url', 'payload_json', 'updated_at', 'email'
];
const ASSET_HEADERS = [
  'record_id', 'project_id', 'asset_name', 'asset_code', 'category', 'quantity',
  'status', 'location', 'date', 'reporter', 'notes', 'drive_url', 'payload_json', 'updated_at', 'email'
];
const CHECKLIST_HEADERS = [
  'record_id', 'project_id', 'date', 'area', 'discipline', 'work', 'status', 'progress',
  'supervisor', 'assignee', 'due_date', 'notes', 'drive_url', 'payload_json', 'updated_at', 'email'
];
const DAILY_REPORT_HEADERS = [
  'record_id', 'project_id', 'report_title', 'date', 'supervisor', 'task_count',
  'total_workers', 'task_summary', 'payload_json', 'updated_at', 'email'
];
const PROJECT_FILE_HEADERS = [
  'File ID', 'Project ID', 'Folder ID', 'File Name', 'Drive URL', 'Size',
  'Uploaded By', 'Created At', 'MIME Type', 'Payload JSON'
];
const PROJECT_FOLDER_HEADERS = ['Folder ID', 'Project ID', 'Folder Name', 'Created At', 'Created By'];
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
      snapshots,
      projectFolders: readProjectFolders_(SpreadsheetApp.openById(SPREADSHEET_ID), projectIds)
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
    if (request.action === 'saveProjectFolders') {
      lock.waitLock(20000);
      const projectId = String(request.projectId || '');
      const project = getAuthorizedProjects_(identity.email).find((entry) => entry.projectId === projectId);
      if (!project) throw new Error('Akun tidak memiliki akses ke proyek ini.');
      return jsonOutput_({
        status: 'success',
        folders: saveProjectFolders_(projectId, request.folders, identity.email)
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

function getSchemaSheet_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return sheet;
  }

  const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0].map((value) => String(value).trim().toLowerCase());
  headers.forEach((header) => {
    if (!existingHeaders.includes(header.toLowerCase())) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      existingHeaders.push(header.toLowerCase());
    }
  });
  return sheet;
}

function getMonitoringSheet_() {
  if (SPREADSHEET_ID.indexOf('PASTE_') === 0) throw new Error('SPREADSHEET_ID belum dikonfigurasi di Code.gs.');
  return getSchemaSheet_(SpreadsheetApp.openById(SPREADSHEET_ID), MONITORING_SHEET_NAME, MONITORING_HEADERS);
}

function getSheetHeaderIndexes_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map((value) => String(value).trim().toLowerCase());
}

function getSheetCell_(row, headers, name) {
  const index = headers.indexOf(name.toLowerCase());
  return index < 0 ? '' : row[index];
}

function readRecordRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const headers = getSheetHeaderIndexes_(sheet);
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .filter((row) => getSheetCell_(row, headers, 'record_id'))
    .map((row) => ({
      recordId: String(getSheetCell_(row, headers, 'record_id')),
      projectId: String(getSheetCell_(row, headers, 'project_id')),
      recordType: String(getSheetCell_(row, headers, 'record_type')),
      itemName: String(getSheetCell_(row, headers, 'item_name')),
      status: String(getSheetCell_(row, headers, 'status')),
      date: String(getSheetCell_(row, headers, 'date')),
      reporter: String(getSheetCell_(row, headers, 'reporter')),
      notes: String(getSheetCell_(row, headers, 'notes')),
      driveUrl: String(getSheetCell_(row, headers, 'drive_url')),
      payload: parseJson_(getSheetCell_(row, headers, 'payload_json')),
      updatedAt: String(getSheetCell_(row, headers, 'updated_at')),
      email: String(getSheetCell_(row, headers, 'email'))
    }));
}

function readTypedRecords_(spreadsheet, sheetName, headers, recordType, itemNameColumn) {
  const sheet = getSchemaSheet_(spreadsheet, sheetName, headers);
  if (sheet.getLastRow() < 2) return [];
  const headerIndexes = getSheetHeaderIndexes_(sheet);
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .filter((row) => getSheetCell_(row, headerIndexes, 'record_id'))
    .map((row) => {
      const email = String(getSheetCell_(row, headerIndexes, 'email'));
      const updatedAt = String(getSheetCell_(row, headerIndexes, 'updated_at'));
      return {
        recordId: String(getSheetCell_(row, headerIndexes, 'record_id')),
        projectId: String(getSheetCell_(row, headerIndexes, 'project_id')),
        recordType: recordType,
        itemName: String(getSheetCell_(row, headerIndexes, itemNameColumn)),
        status: String(getSheetCell_(row, headerIndexes, 'status')),
        date: String(getSheetCell_(row, headerIndexes, 'date') || updatedAt),
        reporter: String(getSheetCell_(row, headerIndexes, 'reporter') || getSheetCell_(row, headerIndexes, 'supervisor') || email),
        notes: String(getSheetCell_(row, headerIndexes, 'notes') || getSheetCell_(row, headerIndexes, 'task_summary')),
        driveUrl: String(getSheetCell_(row, headerIndexes, 'drive_url') || getSheetCell_(row, headerIndexes, 'photo_url')),
        payload: parseJson_(getSheetCell_(row, headerIndexes, 'payload_json')),
        updatedAt: updatedAt,
        email: email
      };
    });
}

function readProjectDataRecords_(spreadsheet) {
  const sheet = getSchemaSheet_(spreadsheet, PROJECT_DATA_SHEET_NAME, PROJECT_DATA_HEADERS);
  if (sheet.getLastRow() < 2) return [];
  const headers = getSheetHeaderIndexes_(sheet);
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .filter((row) => getSheetCell_(row, headers, 'project id') && getSheetCell_(row, headers, 'snapshot json'))
    .map((row, index) => {
      const rawChunkIndex = getSheetCell_(row, headers, 'chunk index');
      const chunkIndex = rawChunkIndex === '' ? index : Number(rawChunkIndex);
      return {
        recordId: 'snapshot:' + getSheetCell_(row, headers, 'project id') + ':' + chunkIndex,
        projectId: String(getSheetCell_(row, headers, 'project id')),
        recordType: 'snapshot_chunk',
        itemName: 'Project snapshot',
        status: String(chunkIndex),
        date: String(getSheetCell_(row, headers, 'updated at')),
        reporter: String(getSheetCell_(row, headers, 'updated by')),
        notes: 'Snapshot chunk',
        driveUrl: '',
        payload: String(getSheetCell_(row, headers, 'snapshot json')),
        updatedAt: String(getSheetCell_(row, headers, 'updated at')),
        email: String(getSheetCell_(row, headers, 'updated by'))
      };
    });
}

function readProjectFileRecords_(spreadsheet) {
  const sheet = getSchemaSheet_(spreadsheet, PROJECT_FILES_SHEET_NAME, PROJECT_FILE_HEADERS);
  if (sheet.getLastRow() < 2) return [];
  const headers = getSheetHeaderIndexes_(sheet);
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .filter((row) => getSheetCell_(row, headers, 'file id'))
    .map((row) => {
      const fileId = String(getSheetCell_(row, headers, 'file id')).replace(/^file:/, '');
      const projectId = String(getSheetCell_(row, headers, 'project id'));
      const createdAt = String(getSheetCell_(row, headers, 'created at'));
      const uploadedBy = String(getSheetCell_(row, headers, 'uploaded by'));
      const payload = parseJson_(getSheetCell_(row, headers, 'payload json')) || {
        id: fileId,
        projectId: projectId,
        folderId: String(getSheetCell_(row, headers, 'folder id')),
        name: String(getSheetCell_(row, headers, 'file name')),
        driveUrl: String(getSheetCell_(row, headers, 'drive url')),
        size: Number(getSheetCell_(row, headers, 'size')) || 0,
        type: String(getSheetCell_(row, headers, 'mime type')),
        addedAt: createdAt
      };
      return {
        recordId: 'file:' + fileId,
        projectId: projectId,
        recordType: 'file',
        itemName: payload.name || String(getSheetCell_(row, headers, 'file name')),
        status: 'UPLOADED',
        date: createdAt,
        reporter: uploadedBy,
        notes: 'Drive file',
        driveUrl: payload.driveUrl || String(getSheetCell_(row, headers, 'drive url')),
        payload: payload,
        updatedAt: createdAt,
        email: uploadedBy
      };
    });
}

function readProjectFolders_(spreadsheet, projectIds) {
  const sheet = getSchemaSheet_(spreadsheet, PROJECT_FOLDERS_SHEET_NAME, PROJECT_FOLDER_HEADERS);
  if (sheet.getLastRow() < 2) return [];
  const headers = getSheetHeaderIndexes_(sheet);
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .filter((row) => projectIds.has(String(getSheetCell_(row, headers, 'project id'))))
    .map((row) => ({
      id: String(getSheetCell_(row, headers, 'folder id')),
      projectId: String(getSheetCell_(row, headers, 'project id')),
      name: String(getSheetCell_(row, headers, 'folder name')),
      createdAt: String(getSheetCell_(row, headers, 'created at')),
      createdBy: String(getSheetCell_(row, headers, 'created by'))
    }))
    .filter((folder) => folder.id && folder.name);
}

function saveProjectFolders_(projectId, folders, email) {
  if (!projectId) throw new Error('ID proyek wajib diisi.');
  if (!Array.isArray(folders) || folders.length > 200) throw new Error('Daftar folder tidak valid.');

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getSchemaSheet_(spreadsheet, PROJECT_FOLDERS_SHEET_NAME, PROJECT_FOLDER_HEADERS);
  const existing = readProjectFolders_(spreadsheet, new Set([projectId]));
  const createdAtById = new Map(existing.map((folder) => [folder.id, folder.createdAt]));
  const seenIds = new Set();
  const seenNames = new Set();
  const rows = folders.map((folder) => {
    const id = String(folder?.id || '').trim();
    const name = String(folder?.name || '').trim();
    const normalizedName = name.toLocaleLowerCase('id-ID');
    if (!id || !name || name.length > 100) throw new Error('Setiap folder harus memiliki ID dan nama maksimal 100 karakter.');
    if (seenIds.has(id) || seenNames.has(normalizedName)) throw new Error('ID atau nama folder duplikat.');
    seenIds.add(id);
    seenNames.add(normalizedName);
    return sheetRowFromObject_(sheet, {
      'Folder ID': id,
      'Project ID': projectId,
      'Folder Name': name,
      'Created At': createdAtById.get(id) || folder.createdAt || new Date().toISOString(),
      'Created By': email
    });
  });
  replaceProjectRows_(sheet, projectId, rows, 'Project ID');
  return folders.map((folder) => ({ ...folder, projectId: projectId, createdBy: email }));
}

function readMonitoringRecords_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  return [
    ...readRecordRows_(getSchemaSheet_(spreadsheet, MONITORING_SHEET_NAME, MONITORING_HEADERS)),
    ...readProjectDataRecords_(spreadsheet),
    ...readTypedRecords_(spreadsheet, MATERIALS_SHEET_NAME, MATERIAL_HEADERS, 'material', 'material_name'),
    ...readTypedRecords_(spreadsheet, ASSETS_SHEET_NAME, ASSET_HEADERS, 'asset', 'asset_name'),
    ...readTypedRecords_(spreadsheet, CHECKLISTS_SHEET_NAME, CHECKLIST_HEADERS, 'checklist', 'work'),
    ...readTypedRecords_(spreadsheet, DAILY_REPORTS_SHEET_NAME, DAILY_REPORT_HEADERS, 'daily_report', 'report_title'),
    ...readProjectFileRecords_(spreadsheet)
  ];
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

  (snapshot.dailyWorkPlans || []).forEach((report, index) => {
    const tasks = Array.isArray(report.tasks) ? report.tasks : [];
    const taskSummary = tasks.map((task) => [
      task.discipline,
      task.title,
      task.area,
      Number.isFinite(Number(task.workers)) ? Number(task.workers) + ' orang' : ''
    ].filter(Boolean).join(' - ')).join(' | ');
    records.push({
      recordId: 'daily-report:' + (report.id || report.date || index),
      projectId: project.projectId,
      recordType: 'daily_report',
      itemName: report.title || 'Laporan Harian MEP',
      status: 'Tersimpan',
      date: report.date || now,
      reporter: report.supervisor || email,
      notes: taskSummary,
      driveUrl: firstPhotoUrl_(report.photos || report.photo),
      payload: report,
      updatedAt: now,
      email: email
    });
  });
  return records;
}

function firstPhotoUrl_(photos) {
  const list = Array.isArray(photos) ? photos : (photos ? [photos] : []);
  return list.find((photo) => typeof photo === 'string' && /^https:\/\//i.test(photo)) || '';
}

function sheetRowFromObject_(sheet, values) {
  const headers = getSheetHeaderIndexes_(sheet);
  const row = Array(headers.length).fill('');
  Object.keys(values).forEach((key) => {
    const index = headers.indexOf(key.toLowerCase());
    if (index >= 0) row[index] = values[key];
  });
  return row;
}

function structuredRecordRow_(sheet, record) {
  const payload = record.payload || {};
  const values = {
    record_id: record.recordId,
    project_id: record.projectId,
    status: record.status,
    date: record.date,
    reporter: record.reporter,
    notes: record.notes,
    drive_url: record.driveUrl,
    payload_json: JSON.stringify(payload),
    updated_at: record.updatedAt,
    email: record.email
  };

  if (record.recordType === 'material') {
    values.material_name = record.itemName;
    values.unit = payload.unit || '';
    values.qty_received = Number(payload.received) || 0;
    values.qty_issued = Number(payload.issued) || 0;
    values.qty_balance = (Number(payload.received) || 0) - (Number(payload.issued) || 0);
    values.target = Number(payload.target) || 0;
  } else if (record.recordType === 'asset') {
    values.asset_name = record.itemName;
    values.asset_code = payload.code || '';
    values.category = payload.category || '';
    values.quantity = Number(payload.quantity) || 0;
    values.location = payload.location || '';
  } else if (record.recordType === 'checklist') {
    values.area = [payload.floor, payload.room, payload.area].filter(Boolean).join(' / ');
    values.discipline = payload.discipline || payload.category || '';
    values.work = record.itemName;
    values.progress = Number(payload.progress) || 0;
    values.supervisor = payload.supervisor || record.reporter;
    values.assignee = payload.assignee || '';
    values.due_date = payload.dueDate || '';
  } else if (record.recordType === 'daily_report') {
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    values.report_title = record.itemName;
    values.supervisor = payload.supervisor || record.reporter;
    values.task_count = tasks.length;
    values.total_workers = tasks.reduce((total, task) => total + (Number(task.workers) || 0), 0);
    values.task_summary = record.notes;
  }

  return sheetRowFromObject_(sheet, values);
}

function replaceProjectRows_(sheet, projectId, rows, projectIdHeader) {
  const headers = getSheetHeaderIndexes_(sheet);
  const projectIdIndex = headers.indexOf(projectIdHeader.toLowerCase());
  if (projectIdIndex < 0) throw new Error('Kolom project_id tidak ditemukan di tab ' + sheet.getName() + '.');
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existingProjectIds = sheet.getRange(2, projectIdIndex + 1, lastRow - 1, 1).getDisplayValues();
    for (let index = existingProjectIds.length - 1; index >= 0; index--) {
      if (String(existingProjectIds[index][0]) === projectId) sheet.deleteRow(index + 2);
    }
  }
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  }
}

function replaceProjectRecords_(projectId, records) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const monitoringSheet = getSchemaSheet_(spreadsheet, MONITORING_SHEET_NAME, MONITORING_HEADERS);
  const legacyFiles = readRecordRows_(monitoringSheet)
    .filter((record) => record.projectId === projectId && record.recordType === 'file');

  const tableDefinitions = [
    { type: 'material', name: MATERIALS_SHEET_NAME, headers: MATERIAL_HEADERS, itemName: 'material_name' },
    { type: 'asset', name: ASSETS_SHEET_NAME, headers: ASSET_HEADERS, itemName: 'asset_name' },
    { type: 'checklist', name: CHECKLISTS_SHEET_NAME, headers: CHECKLIST_HEADERS, itemName: 'work' },
    { type: 'daily_report', name: DAILY_REPORTS_SHEET_NAME, headers: DAILY_REPORT_HEADERS, itemName: 'report_title' }
  ];

  tableDefinitions.forEach((definition) => {
    const sheet = getSchemaSheet_(spreadsheet, definition.name, definition.headers);
    const rows = records.filter((record) => record.recordType === definition.type)
      .map((record) => structuredRecordRow_(sheet, record));
    replaceProjectRows_(sheet, projectId, rows, 'project_id');
  });

  const projectDataSheet = getSchemaSheet_(spreadsheet, PROJECT_DATA_SHEET_NAME, PROJECT_DATA_HEADERS);
  const snapshotChunks = records.filter((record) => record.recordType === 'snapshot_chunk')
    .sort((first, second) => Number(first.status) - Number(second.status));
  const snapshotRows = snapshotChunks.map((record, index) => sheetRowFromObject_(projectDataSheet, {
    'Project ID': projectId,
    'Snapshot JSON': record.payload || '{}',
    'Updated By': record.email || record.reporter || '',
    'Updated At': record.updatedAt || record.date || new Date().toISOString(),
    'Chunk Index': Number(record.status) || index
  }));
  replaceProjectRows_(projectDataSheet, projectId, snapshotRows, 'Project ID');

  const projectFilesSheet = getSchemaSheet_(spreadsheet, PROJECT_FILES_SHEET_NAME, PROJECT_FILE_HEADERS);
  const previousFiles = readProjectFileRecords_(spreadsheet).filter((record) => record.projectId === projectId);
  const newFiles = records.filter((record) => record.recordType === 'file');
  const allFiles = new Map();
  [...previousFiles, ...legacyFiles, ...newFiles].forEach((record) => allFiles.set(record.recordId, record));
  const fileRows = Array.from(allFiles.values()).map((record) => {
    const file = record.payload || {};
    return sheetRowFromObject_(projectFilesSheet, {
      'File ID': String(file.id || record.recordId.replace(/^file:/, '')),
      'Project ID': projectId,
      'Folder ID': file.folderId || '',
      'File Name': record.itemName || file.name || '',
      'Drive URL': record.driveUrl || file.driveUrl || '',
      'Size': Number(file.size) || 0,
      'Uploaded By': record.reporter || record.email || '',
      'Created At': record.date || file.addedAt || '',
      'MIME Type': file.type || '',
      'Payload JSON': JSON.stringify(file)
    });
  });
  replaceProjectRows_(projectFilesSheet, projectId, fileRows, 'Project ID');

  replaceProjectRows_(monitoringSheet, projectId, [], 'project_id');
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
    folderName: String(fileData.folderName || ''),
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
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getSchemaSheet_(spreadsheet, PROJECT_FILES_SHEET_NAME, PROJECT_FILE_HEADERS);
  const file = record.payload || {};
  const row = sheetRowFromObject_(sheet, {
    'File ID': String(file.id || record.recordId.replace(/^file:/, '')),
    'Project ID': record.projectId,
    'Folder ID': file.folderId || '',
    'File Name': record.itemName || file.name || '',
    'Drive URL': record.driveUrl || file.driveUrl || '',
    'Size': Number(file.size) || 0,
    'Uploaded By': record.reporter || record.email || '',
    'Created At': record.date || file.addedAt || '',
    'MIME Type': file.type || '',
    'Payload JSON': JSON.stringify(file)
  });
  sheet.appendRow(row);
}

function deleteDriveFile_(projectId, fileId) {
  if (!fileId) throw new Error('ID file wajib diisi.');
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getSchemaSheet_(spreadsheet, PROJECT_FILES_SHEET_NAME, PROJECT_FILE_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('File tidak ditemukan.');
  const headers = getSheetHeaderIndexes_(sheet);
  const fileIdIndex = headers.indexOf('file id');
  const projectIdIndex = headers.indexOf('project id');
  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  const rowIndex = rows.findIndex((row) =>
    String(row[fileIdIndex]).replace(/^file:/, '') === fileId
      && String(row[projectIdIndex]) === projectId);
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
