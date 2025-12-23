// content.js

class PandAExtension {
  // ... (Constructor and other methods remain unchanged) ...
  constructor() {
    this.assignments = [];
    this.processedCourses = 0;
    this.totalCourses = 0;
    this.kulasisCache = {};

    // Load state
    this.width = parseInt(localStorage.getItem('panda_sidebar_width')) || 300;
    this.isCollapsed = localStorage.getItem('panda_sidebar_collapsed') === 'true';
    this.minWidth = 30;

    // Load cache
    chrome.storage.local.get(['kulasisCache'], (result) => {
      if (result.kulasisCache) {
        this.kulasisCache = result.kulasisCache;
      }
    });

    this.init();
  }

  init() {
    console.log("PandA Extension Initializing...");
    this.injectSidebar();
    this.initResourcesPage();
    this.initExternalLinks();
    this.initDropdownObserver();
    this.initSubmissionCheck();
    this.startFetching();
  }

  // ... (Sidebar and Assignment logic) ...
  injectSidebar() {
    if (document.getElementById('panda-extension-sidebar')) return;
    const initialWidth = this.isCollapsed ? this.minWidth : this.width;
    document.body.style.marginLeft = `${initialWidth}px`;
    const sidebar = document.createElement('div');
    sidebar.id = 'panda-extension-sidebar';
    sidebar.style.width = `${initialWidth}px`;
    const contentDisplay = this.isCollapsed ? 'none' : 'block';
    sidebar.innerHTML = `
      <div id="panda-sidebar-header" style="display: ${contentDisplay};"><h2>Assignments</h2></div>
      <button id="panda-extension-toggle" style="position: absolute; right: 2px; top: 10px; z-index: 100000;">${this.isCollapsed ? '>' : '<'}</button>
      <div id="panda-content-wrapper" style="display: ${contentDisplay};">
        <div id="panda-status" class="loading-spinner">Loading courses...</div>
        <div id="panda-cards-container"></div>
      </div>
      <div id="panda-sidebar-resizer"></div>
    `;
    document.body.appendChild(sidebar);
    const toggleBtn = document.getElementById('panda-extension-toggle');
    toggleBtn.addEventListener('click', () => { this.toggleSidebar(); });
    const resizer = document.getElementById('panda-sidebar-resizer');
    resizer.addEventListener('mousedown', (e) => this.initResize(e));
  }

  toggleSidebar() {
    document.body.classList.add('panda-transition');
    const sidebar = document.getElementById('panda-extension-sidebar');
    sidebar.classList.add('panda-transition');
    this.isCollapsed = !this.isCollapsed;
    localStorage.setItem('panda_sidebar_collapsed', this.isCollapsed);
    const newWidth = this.isCollapsed ? this.minWidth : this.width;
    const contentDisplay = this.isCollapsed ? 'none' : 'block';
    sidebar.style.width = `${newWidth}px`;
    document.body.style.marginLeft = `${newWidth}px`;
    document.getElementById('panda-sidebar-header').style.display = contentDisplay;
    document.getElementById('panda-content-wrapper').style.display = contentDisplay;
    document.getElementById('panda-extension-toggle').innerText = this.isCollapsed ? '>' : '<';
  }

  initResize(e) {
    if (this.isCollapsed) return;
    e.preventDefault();
    window.addEventListener('mousemove', this.doResize);
    window.addEventListener('mouseup', this.stopResize);
    document.body.classList.remove('panda-transition');
    document.getElementById('panda-extension-sidebar').classList.remove('panda-transition');
  }

  doResize = (e) => {
    let newWidth = e.clientX;
    if (newWidth < 150) newWidth = 150;
    if (newWidth > 600) newWidth = 600;
    this.width = newWidth;
    const sidebar = document.getElementById('panda-extension-sidebar');
    sidebar.style.width = `${newWidth}px`;
    document.body.style.marginLeft = `${newWidth}px`;
  }

  stopResize = () => {
    window.removeEventListener('mousemove', this.doResize);
    window.removeEventListener('mouseup', this.stopResize);
    localStorage.setItem('panda_sidebar_width', this.width);
  }

  updateStatus(message) {
    const statusEl = document.getElementById('panda-status');
    if (statusEl) statusEl.textContent = message;
  }

  getCourses() {
    const courses = [];
    const links = document.querySelectorAll('nav#linkNav ul#topnav li.Mrphs-sitesNav__menuitem a.link-container');
    links.forEach(link => {
      const title = link.getAttribute('title') || link.innerText;
      const href = link.href;
      if (!title.includes('ホーム') && !title.includes('Home')) {
        courses.push({ title: title.trim(), url: href });
      }
    });
    return courses;
  }

  async startFetching() {
    const courses = this.getCourses();
    this.totalCourses = courses.length;
    this.updateStatus(`Found ${this.totalCourses} courses. Scanning...`);
    for (const course of courses) {
      try {
        await this.processCourse(course);
      } catch (e) {
        console.error(`Error processing ${course.title}:`, e);
      }
      this.processedCourses++;
      this.updateStatus(`Scanned ${this.processedCourses}/${this.totalCourses} courses...`);
    }
    this.updateStatus("");
    const cardCount = document.getElementById('panda-cards-container').children.length;
    if (cardCount === 0) {
      this.updateStatus("No active assignments found.");
    }
  }

  async processCourse(course) {
    const courseDoc = await this.fetchDocument(course.url);
    if (!courseDoc) return;
    const toolLinks = courseDoc.querySelectorAll('nav#toolMenu ul li a');
    let assignmentToolUrl = null;
    for (const link of toolLinks) {
      const text = link.innerText.trim();
      if (text === '課題' || text === 'Assignments') {
        assignmentToolUrl = link.href;
        break;
      }
    }
    if (!assignmentToolUrl) return;
    const listDoc = await this.fetchDocument(assignmentToolUrl);
    if (!listDoc) return;
    const rows = listDoc.querySelectorAll('form[name="listAssignmentsForm"] table tbody tr');
    for (const row of rows) {
      const titleCell = row.querySelector('td[headers="title"]');
      const statusCell = row.querySelector('td[headers="status"]');
      const dueCell = row.querySelector('td[headers="dueDate"]');
      if (!titleCell || !statusCell || !dueCell) continue;
      const titleLink = titleCell.querySelector('a');
      if (!titleLink) continue;
      const title = titleLink.innerText.trim();
      const detailUrl = titleLink.href;
      const status = statusCell.innerText.trim();
      const dueDateStr = dueCell.innerText.trim();
      if (this.isExpired(dueDateStr)) continue;
      if (status.startsWith('提出済み') || status.startsWith('Submitted')) continue;
      const description = await this.fetchAssignmentDescription(detailUrl);
      const assignment = {
        course: course.title,
        title: title,
        status: status,
        dueDate: dueDateStr,
        description: description,
        url: detailUrl
      };
      this.assignments.push(assignment);
      this.addCard(assignment);
    }
  }

  async fetchAssignmentDescription(url) {
    try {
      const doc = await this.fetchDocument(url);
      if (!doc) return "";
      const textPanel = doc.querySelector('.textPanel');
      if (textPanel) return textPanel.innerText.trim();
      return "";
    } catch (e) {
      return "";
    }
  }

  async fetchDocument(url) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      const parser = new DOMParser();
      return parser.parseFromString(text, 'text/html');
    } catch (e) {
      return null;
    }
  }

  isExpired(dateStr) {
    const now = new Date();
    const due = new Date(dateStr);
    if (isNaN(due.getTime())) return false;
    return due < now;
  }

  addCard(assignment) {
    const container = document.getElementById('panda-cards-container');
    const now = new Date();
    const due = new Date(assignment.dueDate);
    let timeClass = 'far-future';
    let timeLeftMsg = '';
    if (!isNaN(due.getTime())) {
      const diffMs = due - now;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      const diffHours = diffMs / (1000 * 60 * 60);
      if (diffHours < 24) timeClass = 'urgent';
      else if (diffDays < 5) timeClass = 'warning';
      else if (diffDays < 14) timeClass = 'safe';
      else timeClass = 'far-future';
      timeLeftMsg = `${Math.floor(diffDays)}d ${Math.floor((diffHours % 24))}h left`;
    }
    const card = document.createElement('div');
    card.className = `panda-assignment-card ${timeClass}`;
    card.innerHTML = `
      <a href="${assignment.url}" class="panda-card-title" target="_blank">${assignment.title}</a>
      <div class="panda-card-course">${assignment.course}</div>
      <div class="panda-card-due">
        Due: ${assignment.dueDate} <br>
        <small>${timeLeftMsg}</small>
      </div>
      <div class="panda-card-status">Status: ${assignment.status}</div>
      ${assignment.description ? `<div class="panda-card-desc">${this.truncate(assignment.description, 100)}</div>` : ''}
    `;
    container.appendChild(card);
  }

  truncate(str, n) {
    return (str.length > n) ? str.substr(0, n - 1) + '...' : str;
  }

  // ... (Resources logic) ...
  initResourcesPage() {
    const resourcesContainer = document.querySelector('.Mrphs-sakai-resources');
    if (!resourcesContainer) return;
    const buttonContainer = document.querySelector('.Mrphs-toolTitleNav__button_container');
    if (!buttonContainer) return;
    this.injectDownloadButton(buttonContainer);
  }

  injectDownloadButton(container) {
    if (document.getElementById('panda-download-all-btn')) return;
    const btn = document.createElement('a');
    btn.id = 'panda-download-all-btn';
    btn.href = 'javascript:void(0);';
    btn.className = 'Mrphs-toolTitleNav__link';
    btn.style.marginLeft = '10px';
    btn.style.cursor = 'pointer';
    btn.title = 'Download All Resources';
    btn.innerHTML = `
      <span class="fa fa-download" aria-hidden="true"></span>
      <span class="Mrphs-itemTitle">Download All</span>
    `;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.downloadAllResources();
    });
    container.appendChild(btn);
  }

  async downloadAllResources() {
    const courseNameEl = document.querySelector('.Mrphs-hierarchy--siteName-label');
    let courseName = courseNameEl ? courseNameEl.innerText.trim() : 'Course_Resources';
    const safeCourseName = courseName.replace(/[<>:"/\\|?*]+/g, '_');
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const zipFilename = `${safeCourseName}_授業資料_${dateStr}.zip`;
    const zip = new JSZip();
    const rootFolder = zip.folder(safeCourseName);
    const btn = document.getElementById('panda-download-all-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span class="fa fa-spinner fa-spin"></span> Connecting...`;

    try {
        const siteIdMatch = window.location.href.match(/\/site\/([a-zA-Z0-9-]+)/);
        let siteId = siteIdMatch ? siteIdMatch[1] : null;
        if (!siteId) throw new Error("Could not determine Site ID.");
        const webDavUrl = `${window.location.origin}/dav/group/${siteId}/`;
        const fileList = await this.crawlWebDav(webDavUrl);
        if (fileList.length === 0) {
            console.warn("WebDAV returned no files, falling back to page scraping.");
            await this.scrapeCurrentPage(rootFolder, btn);
        } else {
            let count = 0;
            const promises = fileList.map(item => {
                return fetch(item.url)
                    .then(resp => {
                        if (!resp.ok) throw new Error(`Failed: ${item.name}`);
                        return resp.blob();
                    })
                    .then(blob => {
                        const decodedPath = decodeURIComponent(item.path);
                        rootFolder.file(decodedPath, blob);
                        count++;
                        btn.innerHTML = `<span class="fa fa-spinner fa-spin"></span> ${count}/${fileList.length}`;
                    })
                    .catch(e => console.error(e));
            });
            await Promise.all(promises);
        }
        btn.innerHTML = `<span class="fa fa-spinner fa-spin"></span> Zipping...`;
        const content = await zip.generateAsync({ type: "blob" });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = zipFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        btn.innerHTML = originalText;
    } catch (e) {
        console.error("Batch download failed:", e);
        try {
             await this.scrapeCurrentPage(rootFolder, btn);
             const content = await zip.generateAsync({ type: "blob" });
             const a = document.createElement('a');
             a.href = URL.createObjectURL(content);
             a.download = zipFilename;
             document.body.appendChild(a);
             a.click();
             document.body.removeChild(a);
             URL.revokeObjectURL(a.href);
             btn.innerHTML = originalText;
        } catch(e2) {
             alert("Download failed. Please refresh and try again.");
             btn.innerHTML = originalText;
        }
    }
  }

  async crawlWebDav(url, relativePath = "") {
      try {
          const response = await fetch(url);
          if (!response.ok) return [];
          const text = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(text, 'text/html');
          const links = doc.querySelectorAll('a');
          let files = [];
          for (const link of links) {
              const href = link.getAttribute('href');
              const name = link.innerText.trim();
              if (name === '../' || name === 'Parent Directory') continue;
              const absoluteUrl = new URL(href, url).href;
              if (href.endsWith('/')) {
                  const subPath = relativePath + decodeURIComponent(href);
                  const subFiles = await this.crawlWebDav(absoluteUrl, subPath);
                  files = files.concat(subFiles);
              } else {
                  files.push({
                      url: absoluteUrl,
                      path: relativePath + decodeURIComponent(name),
                      name: name
                  });
              }
          }
          return files;
      } catch (e) {
          console.error("WebDAV crawl error:", e);
          return [];
      }
  }

  async scrapeCurrentPage(folder, btn) {
      const rows = document.querySelectorAll('form[name="showForm"] table tbody tr');
      const promises = [];
      let fileCount = 0;
      rows.forEach(row => {
          const titleCell = row.querySelector('td.specialLink.title');
          if (!titleCell) return;
          if (titleCell.querySelector('.fa-folder-open, .fa-folder')) return;
          const fileLink = titleCell.querySelector('a[href*="/access/content/"]:not([class*="fa-"])');
          if (!fileLink) return;
          const fileUrl = fileLink.href;
          const fileName = fileLink.innerText.trim() || "unknown_file";
          promises.push(
              fetch(fileUrl)
                  .then(resp => {
                      if (!resp.ok) throw new Error(`Failed: ${fileName}`);
                      return resp.blob();
                  })
                  .then(blob => {
                      let nameToUse = fileName;
                      let counter = 1;
                      while(folder.file(nameToUse)) {
                          const dotIndex = fileName.lastIndexOf('.');
                          if(dotIndex !== -1) {
                              nameToUse = `${fileName.substring(0, dotIndex)} (${counter})${fileName.substring(dotIndex)}`;
                          } else {
                              nameToUse = `${fileName} (${counter})`;
                          }
                          counter++;
                      }
                      folder.file(nameToUse, blob);
                      fileCount++;
                      if(btn) btn.innerHTML = `<span class="fa fa-spinner fa-spin"></span> Scraped ${fileCount}...`;
                  })
                  .catch(e => console.error(e))
          );
      });
      await Promise.all(promises);
  }

  // --- External Links ---
  async initExternalLinks() {
    const toolMenuUl = document.querySelector('nav#toolMenu ul');
    if (!toolMenuUl) return;
    if (document.getElementById('panda-ext-syllabus')) return;

    const siteNameEl = document.querySelector('.Mrphs-hierarchy--siteName-label');
    if (!siteNameEl) return;

    const fullCourseName = siteNameEl.innerText.trim();
    const { courseName, year, semester } = this.parseCourseString(fullCourseName);

    // KULASIS
    let syllabusUrl = `https://www.k.kyoto-u.ac.jp/student/la/entry/${semester}`;
    // Use the resolve function
    this.resolveKulasisUrl(courseName, year, semester)
      .then(url => {
        if(url) {
           const existingLink = document.getElementById('panda-ext-syllabus');
           if(existingLink) existingLink.querySelector('a').href = url;
        }
      });

    this.addToolMenuLink(toolMenuUl, 'panda-ext-syllabus', 'シラバス (KULASIS)', syllabusUrl, 'fa-book');

    const ku1025Url = `https://ku1025.netlify.app/${courseName}.html`;
    this.addToolMenuLink(toolMenuUl, 'panda-ext-ku1025', '過去問 (ku1025)', ku1025Url, 'fa-history');

    const kuwikiUrl = `https://www.kuwiki.net/?q=${encodeURIComponent(courseName)}`;
    this.addToolMenuLink(toolMenuUl, 'panda-ext-kuwiki', '過去問 (kuwiki)', kuwikiUrl, 'fa-globe');
  }

  addToolMenuLink(ul, id, text, href, iconClass) {
    if (document.getElementById(id)) return;
    const li = document.createElement('li');
    li.id = id;
    li.innerHTML = `
      <a class="Mrphs-toolsNav__menuitem--link" href="${href}" target="_blank" title="${text}">
        <div class="Mrphs-toolsNav__menuitem--icon ${iconClass} fa ${iconClass}"></div>
        <div class="Mrphs-toolsNav__menuitem--title">${text}</div>
      </a>
    `;
    ul.appendChild(li);
  }

  // --- Dropdown Menu Integration ---
  initDropdownObserver() {
    const topNav = document.getElementById('topnav');
    if (!topNav) return;

    const existingSubmenus = topNav.querySelectorAll('ul.Mrphs-sitesNav__submenu');
    existingSubmenus.forEach(submenu => this.handleDropdown(submenu));

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
             if (node.nodeType === 1 && node.classList.contains('Mrphs-sitesNav__submenu')) {
                 this.handleDropdown(node);
             } else if (node.nodeType === 1 && node.querySelector && node.querySelector('.Mrphs-sitesNav__submenu')) {
                 const submenu = node.querySelector('.Mrphs-sitesNav__submenu');
                 this.handleDropdown(submenu);
             }
          });
        }
      });
    });

    observer.observe(topNav, { childList: true, subtree: true });
  }

  handleDropdown(submenu) {
    if (submenu.dataset.pandaExtProcessed) return;
    submenu.dataset.pandaExtProcessed = 'true';

    const li = submenu.closest('li.Mrphs-sitesNav__menuitem');
    if (!li) return;
    const linkContainer = li.querySelector('a.link-container');
    if (!linkContainer) return;

    const fullCourseName = (linkContainer.getAttribute('title') || linkContainer.innerText).trim();
    if (fullCourseName.includes('ホーム') || fullCourseName.includes('Home')) return;

    const { courseName, year, semester } = this.parseCourseString(fullCourseName);

    const kulasisId = `panda-dd-kulasis-${Math.random().toString(36).substr(2, 9)}`;
    const defaultKulasisUrl = `https://www.k.kyoto-u.ac.jp/student/la/entry/${semester}`;
    this.addDropdownItem(submenu, kulasisId, 'シラバス (KULASIS)', defaultKulasisUrl, 'icon-sakai--sakai-iframe-site');

    this.resolveKulasisUrl(courseName, year, semester).then(url => {
        if(url) {
            const el = document.getElementById(kulasisId);
            if(el) el.href = url;
        }
    });

    const ku1025Url = `https://ku1025.netlify.app/${courseName}.html`;
    this.addDropdownItem(submenu, null, '過去問 (ku1025)', ku1025Url, 'icon-sakai--sakai-section-info');

    const kuwikiUrl = `https://www.kuwiki.net/?q=${encodeURIComponent(courseName)}`;
    this.addDropdownItem(submenu, null, '過去問 (kuwiki)', kuwikiUrl, 'icon-sakai--sakai-section-info');
  }

  addDropdownItem(submenu, id, text, href, iconClass) {
      const li = document.createElement('li');
      li.className = 'Mrphs-sitesNav__submenuitem';
      const a = document.createElement('a');
      if(id) a.id = id;
      a.className = 'Mrphs-sitesNav__submenuitem-link';
      a.href = href;
      a.target = '_blank';
      a.title = text;
      a.setAttribute('role', 'menuitem');
      a.tabIndex = -1;

      let innerIcon = '';
      if (iconClass.startsWith('fa-')) {
          innerIcon = `<span class="fa ${iconClass}"></span>`;
      } else {
          innerIcon = `<span class="toolMenuIcon ${iconClass}"></span>`;
      }

      a.innerHTML = `
        <span class="Mrphs-sitesNav__submenuitem-icon">${innerIcon}</span>
        <span class="Mrphs-sitesNav__submenuitem-title">${text}</span>
      `;

      li.appendChild(a);
      submenu.appendChild(li);
  }

  parseCourseString(fullCourseName) {
    let semester = 'kouki';
    let year = new Date().getFullYear();
    const yearMatch = fullCourseName.match(/\[(\d{4})/);
    if (yearMatch) year = yearMatch[1];
    if (fullCourseName.includes('前期')) semester = 'zenki';
    if (fullCourseName.includes('後期')) semester = 'kouki';

    const courseName = fullCourseName.replace(/^\[.*?\]\s*/, '');
    return { courseName, year, semester };
  }

  resolveKulasisUrl(courseName, year, semester) {
    return new Promise((resolve) => {
        // Since we are now using background fetch for KULASIS, the cache in content script is less useful directly unless synced.
        // However, we can check if we have a valid ID cached.
        // Previously: this.kulasisCache[fullCourseName] = id;
        // Here we receive 'courseName', not 'fullCourseName'.
        // To properly cache, we should likely store by courseName or handle the full name logic earlier.
        // For simplicity and correctness with the new background architecture, we will rely on the background fetch or minimal caching if we had full name.
        // But the previous implementation had an empty if block here which was a regression.
        // Let's implement basic caching if we can, or just proceed to fetch.
        // Given the change in signature/logic, we'll skip local cache here to ensure fresh fetch via background which handles the parsing logic.

        chrome.runtime.sendMessage({
            action: "fetchKulasis",
            url: `https://www.k.kyoto-u.ac.jp/student/la/entry/${semester}`
        }, (response) => {
            if (response && response.success) {
                try {
                    const binaryString = atob(response.data);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const decoder = new TextDecoder('shift_jis');
                    const text = decoder.decode(bytes);
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(text, 'text/html');

                    const xpath = `//a[contains(text(), "${courseName}")]`;
                    const result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    const linkNode = result.singleNodeValue;

                    if (linkNode) {
                        const href = linkNode.getAttribute('href');
                        let id = null;
                        if (href && href.includes('no=')) {
                            const match = href.match(/no=(\d+)/);
                            if (match) id = match[1];
                        } else {
                            const onclick = linkNode.getAttribute('onclick');
                            if (onclick) {
                                const match = onclick.match(/(\d{5})/);
                                if (match) id = match[1];
                            }
                        }

                        if (id) {
                            let baseUrl = 'https://www.k.kyoto-u.ac.jp/student/u/t/support/syllabus_detail';
                            if (href && href.includes('/la/')) {
                                baseUrl = 'https://www.k.kyoto-u.ac.jp/student/la/support/lecture_detail';
                            }
                            resolve(`${baseUrl}?no=${id}`);
                            return;
                        }
                    }
                } catch (e) {
                    console.error("KULASIS parse error:", e);
                }
            }
            resolve(null);
        });
    });
  }

  // --- Submission Tweet Button ---

async initSubmissionCheck() {
      // 1. 提出成功バナーの確認
      const successBanner = document.querySelector('.sak-banner-success');
      // バナーが存在しない、または「提出されました」の文言がない場合は終了
      if (!successBanner || !successBanner.textContent.includes('あなたの課題は提出されました')) return;

      const userMessage = "あなたの課題は提出されました． この情報が記された確認のためのメールがあなた宛に送信されます．";

      // 2. 概要テーブル（itemSummary）から情報の抽出
      const summaryTable = document.querySelector('table.itemSummary');
      if (!summaryTable) return;

      let courseName = "";
      let assignmentTitle = "";
      let submissionTime = "";

      const rows = summaryTable.querySelectorAll('tr');
      rows.forEach(row => {
          const th = row.querySelector('th');
          const header = th ? th.textContent.trim() : "";
          const td = row.querySelector('td');

          if (!td) return;

          // クラスサイト名の取得
          if (header.includes('クラスサイト')) {
              courseName = td.textContent.trim();
          }
          // 課題タイトルの取得（リンクや余計な空白を考慮）
          if (header.includes('課題')) {
              let titleText = "";
              td.childNodes.forEach(node => {
                  if (node.nodeType === Node.TEXT_NODE) {
                      titleText += node.textContent;
                  } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'A') {
                      titleText += node.textContent;
                  }
              });
              assignmentTitle = titleText.trim();
          }
          // 提出日時の取得
          if (header.includes('提出日時')) {
              submissionTime = td.textContent.trim();
          }
      });

      // 必須情報が欠けている場合は中止
      if (!courseName || !assignmentTitle || !submissionTime) return;

      // 3. 締切日時を取得するために「課題」ツールのURLを特定
      let assignmentsUrl = null;
      const toolLinks = document.querySelectorAll('nav#toolMenu ul li a');
      for (const link of toolLinks) {
          const text = link.textContent.trim();
          if (text === '課題' || text === 'Assignments') {
              assignmentsUrl = link.href;
              break;
          }
      }

      let dueDate = null;

      // タイトル照合用の正規化関数（空白と改行を完全に除去）
      const normalize = s => (s || "").replace(/\s+/g, '');

      if (assignmentsUrl) {
          try {
              // 課題一覧ページを非同期で取得
              const listDoc = await this.fetchDocument(assignmentsUrl);
              if (listDoc) {
                  // DOMParserで解析したドキュメントには textContent を使用する
                  const assignRows = listDoc.querySelectorAll('form[name="listAssignmentsForm"] table tbody tr');
                  for (const row of assignRows) {
                      const titleCell = row.querySelector('td[headers="title"]');
                      if (!titleCell) continue;

                      const link = titleCell.querySelector('a');
                      const rowTitle = link ? (link.getAttribute('title') || link.textContent).trim() : titleCell.textContent.trim();

                      // 正規化したタイトル同士で部分一致を確認
                      if (normalize(rowTitle).includes(normalize(assignmentTitle)) || normalize(assignmentTitle).includes(normalize(rowTitle))) {
                          const dueCell = row.querySelector('td[headers="dueDate"]');
                          if (dueCell) {
                              dueDate = dueCell.textContent.trim();
                          }
                          break;
                      }
                  }
              }
          } catch (e) {
              console.error("Error fetching due date:", e);
          }
      }

      // ツイートボタンの生成と注入
      this.injectTweetButton(successBanner, userMessage, courseName, assignmentTitle, submissionTime, dueDate);
  }

  /**
   * 日付文字列をDateオブジェクトに変換する
   * 日本語環境のPandAで一般的な「YYYY/MM/DD HH:mm」形式に対応
   */
  parseDate(dateStr) {
      if (!dateStr) return null;
      // 空白や改行、スラッシュを整理
      const cleanStr = dateStr.trim().replace(/\//g, '-');

      // YYYY-MM-DD HH:mm を YYYY-MM-DDTHH:mm に変換（ISO互換性を高める）
      const isoStr = cleanStr.replace(' ', 'T');
      let d = new Date(isoStr);

      if (!isNaN(d.getTime())) return d;

      // フォールバック: 手動パース
      const match = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})/);
      if (match) {
          return new Date(match[1], match[2] - 1, match[3], match[4], match[5]);
      }
      return null;
  }

  injectTweetButton(banner, message, course, title, subTime, dueTime) {
      let timeDiffStr = "";

      if (dueTime) {
          const subDate = this.parseDate(subTime);
          const dueDate = this.parseDate(dueTime);

          if (subDate && dueDate) {
              const diffMs = dueDate - subDate;
              if (diffMs >= 0) {
                   const diffMinutes = Math.floor(diffMs / (1000 * 60));
                   const days = Math.floor(diffMinutes / (60 * 24));
                   const hours = Math.floor((diffMinutes % (60 * 24)) / 60);
                   const minutes = diffMinutes % 60;

                   if (days > 0) {
                       timeDiffStr = `${days}日${hours}時間${minutes}分`;
                   } else if (hours > 0) {
                       timeDiffStr = `${hours}時間${minutes}分`;
                   } else {
                       timeDiffStr = `${minutes}分`;
                   }
              }
          }
      }

      // Construct Tweet Text
      let text = `${message}\nクラスサイト: ${course}\n課題: ${title}\n提出日時: ${subTime}`;
      if (timeDiffStr) {
          text += ` (期限まで ${timeDiffStr})`;
      }
      const encodedText = encodeURIComponent(text);

      // Fallback URL with text parameter (fixes tweet.png issue where text was missing)
      const tweetUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;

      // Create Button Container
      const container = document.createElement('div');
      container.style.marginTop = '10px';

      const a = document.createElement('a');
      a.href = tweetUrl;
      a.target = '_blank';
      a.style.backgroundColor = '#000';
      a.style.color = '#fff';
      a.style.padding = '8px 16px';
      a.style.textDecoration = 'none';
      a.style.borderRadius = '20px';
      a.style.fontWeight = 'bold';
      a.style.display = 'inline-flex';
      a.style.alignItems = 'center';
      a.style.justifyContent = 'center'; // 中央揃えを追加
      a.style.fontSize = '14px';

      // ここを修正：固定値ではなく '1' に設定することで、
      // 文字の高さに合わせ、余分な隙間を排除します
      a.style.lineHeight = '1';

      a.style.border = '1px solid #333';
      a.style.boxSizing = 'border-box';
      // Embed SVG Logo directly (white fill)
      // viewBox 0 0 1200 1227
      const svg = `
      <svg width="16" height="16" viewBox="0 0 1200 1227" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
        <path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" fill="white"/>
      </svg>
      `;

      a.innerHTML = `${svg}ポスト`;

      container.appendChild(a);
      banner.appendChild(container);
  }
}

new PandAExtension();
