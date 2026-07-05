const DB_NAME = "tryout-video-locker";
const DB_VERSION = 1;
const STORE = "videos";
const CATEGORY_KEY = "tryout.selectedCategory";

const categories = [...document.querySelectorAll(".segment")];
const playerNumber = document.querySelector("#playerNumber");
const recordInput = document.querySelector("#recordInput");
const reviewDialog = document.querySelector("#reviewDialog");
const previewVideo = document.querySelector("#previewVideo");
const filenameField = document.querySelector("#filenameField");
const filenameInput = document.querySelector("#filenameInput");
const saveVideoButton = document.querySelector("#saveVideoButton");
const videoSearch = document.querySelector("#videoSearch");
const videoList = document.querySelector("#videoList");
const emptyState = document.querySelector("#emptyState");
const noResultsState = document.querySelector("#noResultsState");
const savedCount = document.querySelector("#savedCount");
const storageEstimate = document.querySelector("#storageEstimate");
const clearDoneButton = document.querySelector("#clearDoneButton");
const installButton = document.querySelector("#installButton");
const toast = document.querySelector("#toast");

let db;
let pendingFile;
let pendingObjectUrl;
let installPrompt;

init();

async function init() {
  db = await openDb();
  restoreCategory();
  bindEvents();
  await requestPersistentStorage();
  await renderVideos();
  await updateStorageEstimate();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function bindEvents() {
  categories.forEach((button) => {
    button.addEventListener("click", () => setCategory(button.dataset.category));
  });

  recordInput.addEventListener("change", () => handleFile(recordInput.files?.[0], recordInput));
  videoSearch.addEventListener("input", renderVideos);
  saveVideoButton.addEventListener("click", savePendingVideo);
  clearDoneButton.addEventListener("click", clearSharedVideos);

  reviewDialog.addEventListener("close", () => {
    if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
    pendingObjectUrl = null;
    pendingFile = null;
    previewVideo.removeAttribute("src");
    previewVideo.load();
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    installButton.hidden = true;
  });
}

function restoreCategory() {
  setCategory(localStorage.getItem(CATEGORY_KEY) || "Hitting");
}

function setCategory(category) {
  localStorage.setItem(CATEGORY_KEY, category);
  categories.forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.category === category));
  });
}

function selectedCategory() {
  return localStorage.getItem(CATEGORY_KEY) || "Hitting";
}

function handleFile(file, input) {
  input.value = "";
  if (!file) return;

  const number = cleanPlayerNumber(playerNumber.value);
  if (!number) {
    showToast("Enter a player number first.");
    playerNumber.focus();
    return;
  }

  pendingFile = file;
  pendingObjectUrl = URL.createObjectURL(file);
  previewVideo.src = pendingObjectUrl;
  filenameField.hidden = false;
  saveVideoButton.hidden = false;
  filenameInput.value = buildFilename(number, selectedCategory(), file);
  reviewDialog.showModal();
}

async function savePendingVideo() {
  if (!pendingFile) return;

  const name = normalizeFilename(filenameInput.value, pendingFile);
  const clip = {
    id: crypto.randomUUID(),
    name,
    category: selectedCategory(),
    playerNumber: cleanPlayerNumber(playerNumber.value),
    type: pendingFile.type || "video/mp4",
    size: pendingFile.size,
    createdAt: new Date().toISOString(),
    shared: false,
    blob: pendingFile
  };

  await putVideo(clip);
  reviewDialog.close();
  playerNumber.select();
  await renderVideos();
  await updateStorageEstimate();
  showToast("Video saved on this device.");
}

async function renderVideos() {
  const videos = await getAllVideos();
  videos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const query = videoSearch.value.trim().toLowerCase();
  const filtered = query ? videos.filter((video) => videoMatches(video, query)) : videos;

  savedCount.textContent = query ? `${filtered.length} of ${videos.length}` : `${videos.length} saved`;
  emptyState.hidden = videos.length > 0;
  noResultsState.hidden = !videos.length || filtered.length > 0;
  videoList.replaceChildren(...filtered.map(videoRow));
}

function videoMatches(video, query) {
  return [
    video.name,
    video.category,
    video.playerNumber,
    formatBytes(video.size),
    video.shared ? "shared" : ""
  ].some((value) => String(value).toLowerCase().includes(query));
}

function videoRow(video) {
  const row = document.createElement("li");
  row.className = "video-item";

  const detail = document.createElement("div");
  const name = document.createElement("div");
  name.className = "video-name";
  name.textContent = video.name;

  const meta = document.createElement("div");
  meta.className = "video-meta";
  meta.textContent = `${video.category} • Player ${video.playerNumber} • ${formatBytes(video.size)}${video.shared ? " • shared" : ""}`;

  detail.append(name, meta);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(
    actionButton("Preview", "M8 5v14l11-7Z", () => previewSaved(video)),
    actionButton("Share", "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14", () => shareVideo(video)),
    actionButton("Delete", "M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3", () => deleteSavedVideo(video.id))
  );

  row.append(detail, actions);
  return row;
}

function actionButton(label, pathData, handler) {
  const button = document.createElement("button");
  button.className = "icon-button";
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  svg.append(path);

  button.append(svg);
  button.addEventListener("click", handler);
  return button;
}

async function previewSaved(video) {
  const file = new File([video.blob], video.name, { type: video.type });
  pendingFile = file;
  pendingObjectUrl = URL.createObjectURL(file);
  previewVideo.src = pendingObjectUrl;
  filenameInput.value = video.name;
  filenameField.hidden = true;
  saveVideoButton.hidden = true;
  reviewDialog.showModal();
  reviewDialog.addEventListener("close", () => {
    filenameField.hidden = false;
    saveVideoButton.hidden = false;
  }, { once: true });
}

async function shareVideo(video) {
  const file = new File([video.blob], video.name, { type: video.type });

  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: video.name });
      await markShared(video.id);
      showToast("Marked shared.");
    } catch (error) {
      if (error.name !== "AbortError") showToast("Sharing did not finish.");
    }
  } else {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = video.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    await markShared(video.id);
    showToast("Downloaded for sharing.");
  }

  await renderVideos();
}

async function deleteSavedVideo(id) {
  await deleteVideo(id);
  await renderVideos();
  await updateStorageEstimate();
  showToast("Video deleted.");
}

async function clearSharedVideos() {
  const videos = await getAllVideos();
  const shared = videos.filter((video) => video.shared);
  await Promise.all(shared.map((video) => deleteVideo(video.id)));
  await renderVideos();
  await updateStorageEstimate();
  showToast(shared.length ? "Shared videos cleared." : "No shared videos to clear.");
}

function buildFilename(number, category, file) {
  const date = new Date().toISOString().slice(0, 10);
  const extension = extensionFrom(file);
  return `${number}_${category}_${date}${extension}`;
}

function normalizeFilename(value, file) {
  const fallback = buildFilename(cleanPlayerNumber(playerNumber.value), selectedCategory(), file);
  const cleaned = value.trim().replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
  if (!cleaned) return fallback;
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}${extensionFrom(file)}`;
}

function cleanPlayerNumber(value) {
  return value.trim().replace(/[^\dA-Za-z-]/g, "");
}

function extensionFrom(file) {
  const nameMatch = file.name?.match(/\.[a-z0-9]{2,5}$/i);
  if (nameMatch) return nameMatch[0].toLowerCase();
  if (file.type.includes("quicktime")) return ".mov";
  if (file.type.includes("webm")) return ".webm";
  return ".mp4";
}

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

async function updateStorageEstimate() {
  if (!navigator.storage?.estimate) {
    storageEstimate.textContent = "Local storage";
    return;
  }

  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  storageEstimate.textContent = quota ? `${formatBytes(usage)} used` : "Local storage";
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return;
  try {
    await navigator.storage.persist();
  } catch {
    // Some mobile browsers expose the API but decide persistence themselves.
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeTransaction(mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function putVideo(video) {
  return requestPromise(storeTransaction("readwrite").put(video));
}

function deleteVideo(id) {
  return requestPromise(storeTransaction("readwrite").delete(id));
}

function getAllVideos() {
  return requestPromise(storeTransaction().getAll());
}

async function markShared(id) {
  const video = await getVideo(id);
  if (!video) return;
  video.shared = true;
  await putVideo(video);
}

function getVideo(id) {
  return requestPromise(storeTransaction().get(id));
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
