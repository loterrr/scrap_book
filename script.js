document.addEventListener('DOMContentLoaded', () => {

    // ══════════════════════════════════
    // CONSTANTS  (#14 — extracted magic numbers)
    // ══════════════════════════════════
    const SMOOTHING = 0.45;
    const PINCH_THRESHOLD = 45;       // px distance
    const FLIP_DURATION = 460;      // ms
    const DRAG_DEAD_ZONE = 4;        // px before drag registers
    const DRAG_FORWARD_ANGLE = 80;       // degrees to commit forward flip
    const DRAG_BACK_ANGLE = -100;     // degrees to commit backward flip
    const LEFT_ZONE = 0.35;     // left 35% of leaf = backward drag
    const RIGHT_ZONE = 0.65;     // right 35% of leaf = forward drag
    const SAVE_DEBOUNCE_MS = 500;      // localStorage write debounce
    const STORAGE_PREFIX = 'scrapbook_page_';
    const STORAGE_PREFIX_PHOTOS = 'scrapbook_photos_';
    let photoZIndex = 20;

    // ══════════════════════════════════
    // ELEMENTS
    // ══════════════════════════════════
    let leaves = [...document.querySelectorAll('.leaf')];
    const counter = document.getElementById('page-counter');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const restartBtn = document.getElementById('restart-btn');
    const modeIndicator = document.getElementById('mode-indicator');
    const modeText = document.getElementById('mode-text');
    const drawToggleBtn = document.getElementById('draw-toggle-btn');
    const clearBtn = document.getElementById('clear-btn');
    const coverDate = document.getElementById('cover-date');
    const cameraError = document.getElementById('camera-error');

    // Create on-screen finger cursor
    const fingerCursor = document.createElement('div');
    fingerCursor.className = 'finger-cursor';
    fingerCursor.style.display = 'none';
    document.body.appendChild(fingerCursor);

    const total = leaves.length * 2;
    let current = 0;
    let isAnimating = false;

    // Set cover date
    if (coverDate) {
        const now = new Date();
        coverDate.textContent = now.toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    // ══════════════════════════════════
    // DRAWING STATE
    // ══════════════════════════════════
    let activeColor = '#2c1810';
    let penSize = 6;
    let isEraser = false;
    let shiftDown = false;
    let pageCanvases = {};   // page# -> { canvas, ctx }
    const drawingData = {};  // page# -> ImageData (in-memory cache)

    // Debounce timer for localStorage saves
    let saveTimer = null;

    // ══════════════════════════════════
    // CANVAS SETUP (per-page drawing)
    // ══════════════════════════════════
    function initDrawCanvases() {
        document.querySelectorAll('.draw-canvas').forEach(canvas => {
            const pageNum = canvas.dataset.page;
            const parent = canvas.parentElement;
            canvas.width = parent.offsetWidth;
            canvas.height = parent.offsetHeight;
            const ctx = canvas.getContext('2d');
            pageCanvases[pageNum] = { canvas, ctx };

            // Restore from in-memory cache first, then try localStorage (#10)
            if (drawingData[pageNum]) {
                ctx.putImageData(drawingData[pageNum], 0, 0);
            } else {
                restorePageFromStorage(pageNum);
            }

            // Restore photos
            parent.querySelectorAll('.photo-sticker').forEach(el => el.remove());
            restorePhotosFromStorage(pageNum, parent);
        });
    }

    // Save canvas state for a page (in-memory)
    function savePageCanvas(pageNum) {
        const pc = pageCanvases[pageNum];
        if (pc) {
            drawingData[pageNum] = pc.ctx.getImageData(0, 0, pc.canvas.width, pc.canvas.height);
        }
    }

    // ── localStorage persistence (#10) ──

    function savePageToStorage(pageNum) {
        const pc = pageCanvases[pageNum];
        if (!pc) return;
        try {
            const dataURL = pc.canvas.toDataURL('image/png');
            localStorage.setItem(STORAGE_PREFIX + pageNum, dataURL);
        } catch (e) {
            // Storage full or unavailable — silently fail
        }
    }

    function restorePageFromStorage(pageNum) {
        const pc = pageCanvases[pageNum];
        if (!pc) return;
        try {
            const dataURL = localStorage.getItem(STORAGE_PREFIX + pageNum);
            if (dataURL) {
                const img = new Image();
                img.onload = () => {
                    pc.ctx.drawImage(img, 0, 0, pc.canvas.width, pc.canvas.height);
                    // Cache in memory too
                    drawingData[pageNum] = pc.ctx.getImageData(0, 0, pc.canvas.width, pc.canvas.height);
                };
                img.src = dataURL;
            }
        } catch (e) {
            // localStorage unavailable
        }
    }

    function removePageFromStorage(pageNum) {
        try {
            localStorage.removeItem(STORAGE_PREFIX + pageNum);
            localStorage.removeItem(STORAGE_PREFIX_PHOTOS + pageNum);
        } catch (e) { /* ignore */ }
    }

    function savePhotosToStorage(pageNum) {
        const pageContent = document.querySelector(`.page-content[data-page="${pageNum}"]`);
        if (!pageContent) return;

        const photos = [];
        pageContent.querySelectorAll('.photo-sticker').forEach(el => {
            photos.push({
                url: el.style.backgroundImage,
                width: el.style.width,
                height: el.style.height,
                left: el.style.left,
                top: el.style.top,
                transform: el.style.transform,
                zIndex: el.style.zIndex
            });
        });

        try {
            if (photos.length > 0) {
                localStorage.setItem(STORAGE_PREFIX_PHOTOS + pageNum, JSON.stringify(photos));
            } else {
                localStorage.removeItem(STORAGE_PREFIX_PHOTOS + pageNum);
            }
        } catch (e) { }
    }

    function restorePhotosFromStorage(pageNum, container) {
        try {
            const data = localStorage.getItem(STORAGE_PREFIX_PHOTOS + pageNum);
            if (data) {
                const list = JSON.parse(data);
                list.forEach(p => {
                    const el = document.createElement('div');
                    el.className = 'photo-sticker';
                    el.style.width = p.width;
                    el.style.height = p.height;
                    el.style.left = p.left;
                    el.style.top = p.top;
                    el.style.transform = p.transform;
                    el.style.backgroundImage = p.url;
                    if (p.zIndex) {
                        el.style.zIndex = p.zIndex;
                        photoZIndex = Math.max(photoZIndex, parseInt(p.zIndex) + 1);
                    }
                    container.appendChild(el);
                    makeDraggable(el);
                });
            }
        } catch (e) { }
    }

    // Debounced save to localStorage
    function debouncedSaveToStorage(pageNum) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            savePageToStorage(pageNum);
        }, SAVE_DEBOUNCE_MS);
    }

    // Save all dirty pages to localStorage
    function saveAllToStorage() {
        Object.keys(pageCanvases).forEach(pn => {
            savePageCanvas(pn);
            savePageToStorage(pn);
        });
    }

    // ══════════════════════════════════
    // ACTIVE CANVAS HELPERS (#5 — bug fix)
    // ══════════════════════════════════

    // Get the current visible page number(s) based on leaf index
    function getCurrentPageNums() {
        const pages = [];
        const leaf = leaves[current];
        if (!leaf) return pages;

        const frontPage = leaf.querySelector('.front-face .draw-canvas');
        if (frontPage) pages.push(frontPage.dataset.page);

        const backPage = leaf.querySelector('.back-face .draw-canvas');
        if (backPage) pages.push(backPage.dataset.page);

        return pages;
    }

    // Get the active drawing canvas (the currently visible page's canvas)
    // Fix #5: fall back to back-face if front-face has no draw-canvas (e.g. cover)
    function getActiveCanvas() {
        const leaf = leaves[current];
        if (!leaf) return null;

        // Front face of current leaf is the primary visible page
        const frontCanvas = leaf.querySelector('.front-face .draw-canvas');
        if (frontCanvas) return pageCanvases[frontCanvas.dataset.page];

        // If current leaf has no front draw-canvas (e.g. cover page),
        // fall through to the back-face canvas
        const backCanvas = leaf.querySelector('.back-face .draw-canvas');
        if (backCanvas) return pageCanvases[backCanvas.dataset.page];

        return null;
    }

    // ══════════════════════════════════
    // BOOK PHYSICS
    // ══════════════════════════════════
    function initStack() {
        leaves.forEach((leaf, i) => {
            leaf.style.transformOrigin = 'left center';
            leaf.style.transition = 'none';
            leaf.style.transform = 'rotateY(0deg)';
            leaf.style.zIndex = i === 0 ? 10 : (10 - i);
            leaf.style.pointerEvents = i === 0 ? 'auto' : 'none';
            if (leaf._physicsCtrl) { leaf._physicsCtrl.abort(); leaf._physicsCtrl = null; }
        });
        updateUI();
        leaves.forEach(attachPhysics);
    }

    function updateUI() {
        const pageDisplay = current * 2 + 1;
        const totalDisplay = leaves.length * 2;
        if (counter) counter.textContent = `${Math.min(pageDisplay, totalDisplay)} / ${totalDisplay}`;
        if (prevBtn) prevBtn.style.display = current === 0 ? 'none' : 'flex';
        if (nextBtn) nextBtn.style.display = current === leaves.length - 1 ? 'none' : 'flex';
    }

    function attachPhysics(leaf) {
        if (!leaf) return;
        if (leaf._physicsCtrl) leaf._physicsCtrl.abort();
        const ctrl = new AbortController();
        leaf._physicsCtrl = ctrl;
        const sig = { signal: ctrl.signal };

        leaf.addEventListener('mousedown', onDragStart, sig);
        leaf.addEventListener('touchstart', onDragStart, { ...sig, passive: false });

        function onDragStart(e) {
            if (isAnimating) return;
            if (e.target.closest('.restart-btn, .nav-btn, .color-swatch, .pen-size-btn, .clear-btn, .snap-btn, .add-page-btn')) return;

            const rect = leaf.getBoundingClientRect();
            const startX = getClientX(e);
            const relX = startX - rect.left;

            const isLeftSide = relX < rect.width * LEFT_ZONE;
            const isRightSide = relX > rect.width * RIGHT_ZONE;

            if (isLeftSide && current > 0) {
                // BACKWARD DRAG
                e.preventDefault();
                const prevLeaf = leaves[current - 1];
                prevLeaf.style.transition = 'none';
                prevLeaf.style.transform = 'rotateY(-180deg)';
                prevLeaf.style.zIndex = 20;

                let dragAngle = -180;
                let moved = false;

                function onMoveBack(ev) {
                    const mx = getClientX(ev);
                    const dx = mx - startX;
                    if (dx < DRAG_DEAD_ZONE && !moved) return;
                    moved = true;
                    ev.preventDefault();
                    dragAngle = -180 + Math.min(180, Math.max(0, (dx / rect.width) * 180));
                    prevLeaf.style.transform = `rotateY(${dragAngle}deg)`;
                }

                function onUpBack() {
                    cancelDragBack();
                    if (!moved) {
                        prevLeaf.style.transition = 'none';
                        prevLeaf.style.transform = 'rotateY(-180deg)';
                        prevLeaf.style.zIndex = 0;
                        flipBackward();
                        return;
                    }
                    if (dragAngle > DRAG_BACK_ANGLE) {
                        prevLeaf.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
                        prevLeaf.style.transform = 'rotateY(0deg)';
                        prevLeaf.style.zIndex = 10;
                        prevLeaf.style.pointerEvents = 'auto';
                        leaves[current].style.pointerEvents = 'none';
                        leaves[current].style.zIndex = 10 - current;
                        current--;
                        updateUI();
                        setTimeout(() => { isAnimating = false; }, FLIP_DURATION);
                    } else {
                        prevLeaf.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
                        prevLeaf.style.transform = 'rotateY(-180deg)';
                        prevLeaf.style.zIndex = 0;
                    }
                }

                function cancelDragBack() {
                    document.removeEventListener('mousemove', onMoveBack);
                    document.removeEventListener('touchmove', onMoveBack);
                    document.removeEventListener('mouseup', onUpBack);
                    document.removeEventListener('touchend', onUpBack);
                }

                document.addEventListener('mousemove', onMoveBack);
                document.addEventListener('touchmove', onMoveBack, { passive: false });
                document.addEventListener('mouseup', onUpBack);
                document.addEventListener('touchend', onUpBack);

            } else if (isRightSide && leaf === leaves[current] && current < leaves.length - 1) {
                // FORWARD DRAG
                e.preventDefault();
                leaf.style.transition = 'none';

                let dragAngle = 0;
                let moved = false;

                function onMove(ev) {
                    const mx = getClientX(ev);
                    const dx = startX - mx;
                    if (dx < DRAG_DEAD_ZONE && !moved) return;
                    moved = true;
                    ev.preventDefault();
                    dragAngle = -Math.min(178, Math.max(0, (dx / rect.width) * 180));
                    leaf.style.transform = `rotateY(${dragAngle}deg)`;
                }

                function onUp() {
                    cancelDrag();
                    if (!moved) {
                        flipForward();
                        return;
                    }
                    Math.abs(dragAngle) > DRAG_FORWARD_ANGLE ? flipForward() : snapBack(leaf);
                }

                function cancelDrag() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('touchmove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    document.removeEventListener('touchend', onUp);
                }

                document.addEventListener('mousemove', onMove);
                document.addEventListener('touchmove', onMove, { passive: false });
                document.addEventListener('mouseup', onUp);
                document.addEventListener('touchend', onUp);
            }
        }
    }

    function snapBack(leaf) {
        leaf.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
        leaf.style.transform = 'rotateY(0deg)';
    }

    function flipForward() {
        if (current >= leaves.length - 1 || isAnimating) return;
        isAnimating = true;

        // Save current page canvases before flipping
        getCurrentPageNums().forEach(pn => {
            savePageCanvas(pn);
            savePageToStorage(pn);
        });

        const out = leaves[current];
        const into = leaves[current + 1];

        out.style.transition = 'transform 0.45s cubic-bezier(0.55, 0, 0.45, 1)';
        out.style.transform = 'rotateY(-180deg)';

        into.style.zIndex = 20;
        into.style.pointerEvents = 'none';

        setTimeout(() => {
            out.style.zIndex = 0;
            out.style.pointerEvents = 'none';
            into.style.zIndex = 10;
            into.style.pointerEvents = 'auto';
            current++;
            updateUI();
            isAnimating = false;
        }, FLIP_DURATION);
    }

    function flipBackward() {
        if (current <= 0 || isAnimating) return;
        isAnimating = true;

        // Save current page canvases before flipping
        getCurrentPageNums().forEach(pn => {
            savePageCanvas(pn);
            savePageToStorage(pn);
        });

        const prev = leaves[current - 1];
        const cur = leaves[current];

        prev.style.transition = 'none';
        prev.style.transform = 'rotateY(-180deg)';
        prev.style.zIndex = 20;
        cur.style.pointerEvents = 'none';

        prev.getBoundingClientRect();
        prev.style.transition = 'transform 0.45s cubic-bezier(0.55, 0, 0.45, 1)';
        prev.style.transform = 'rotateY(0deg)';

        setTimeout(() => {
            prev.style.zIndex = 10;
            prev.style.pointerEvents = 'auto';
            cur.style.zIndex = 10 - current;
            current--;
            updateUI();
            isAnimating = false;
        }, FLIP_DURATION);
    }

    // Nav buttons
    if (nextBtn) nextBtn.addEventListener('click', flipForward);
    if (prevBtn) prevBtn.addEventListener('click', flipBackward);
    if (restartBtn) restartBtn.addEventListener('click', () => {
        isAnimating = false;
        current = 0;
        initStack();
    });


    // ══════════════════════════════════
    // COLOR PALETTE (click-based)
    // ══════════════════════════════════
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            const color = swatch.dataset.color;
            if (color === 'eraser') {
                isEraser = true;
            } else {
                isEraser = false;
                activeColor = color;
            }
        });
    });

    // Pen size buttons
    document.querySelectorAll('.pen-size-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.pen-size-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            penSize = parseInt(btn.dataset.size);
        });
    });

    // Clear page (also clears localStorage — #10)
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pages = getCurrentPageNums();
            if (pages.length > 0) {
                const pc = pageCanvases[pages[0]];
                if (pc) {
                    pc.ctx.clearRect(0, 0, pc.canvas.width, pc.canvas.height);
                    delete drawingData[pages[0]];
                    removePageFromStorage(pages[0]);

                    const parent = pc.canvas.parentElement;
                    parent.querySelectorAll('.photo-sticker').forEach(el => el.remove());
                }
            }
        });
    }


    // ══════════════════════════════════
    // SNAP PHOTO (camera frame → page canvas)
    // ══════════════════════════════════
    const snapBtn = document.getElementById('snap-btn');
    if (snapBtn) {
        snapBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pc = getActiveCanvas();
            if (!pc) return;

            // Capture current camera frame
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = vid.videoWidth || 640;
            tempCanvas.height = vid.videoHeight || 480;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(vid, 0, 0, tempCanvas.width, tempCanvas.height);

            const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.8);

            // Photo dimensions on the page (scrapbook style)
            const photoW = pc.canvas.width * 0.55;
            const photoH = photoW * (tempCanvas.height / tempCanvas.width);
            const photoX = (pc.canvas.width - photoW) / 2;
            const photoY = (pc.canvas.height - photoH) / 2;
            const rotation = (Math.random() - 0.5) * 15; // degrees

            const photoEl = document.createElement('div');
            photoEl.className = 'photo-sticker';
            photoEl.style.width = photoW + 'px';
            photoEl.style.height = photoH + 'px';
            photoEl.style.left = photoX + 'px';
            photoEl.style.top = photoY + 'px';
            photoEl.style.transform = `rotate(${rotation}deg)`;
            photoEl.style.backgroundImage = `url(${dataUrl})`;

            photoZIndex++;
            photoEl.style.zIndex = photoZIndex;

            const container = pc.canvas.parentElement;
            container.appendChild(photoEl);
            makeDraggable(photoEl);

            const pageNum = pc.canvas.dataset.page;
            savePhotosToStorage(pageNum);

            // Flash effect on the button
            snapBtn.style.background = 'rgba(255,255,255,0.6)';
            setTimeout(() => { snapBtn.style.background = ''; }, 200);
        });
    }

    function makeDraggable(el) {
        let isDragging = false;
        let startX, startY, initialX, initialY;

        function onPointerDown(e) {
            e.stopPropagation(); // prevent book drag
            if (e.target.closest('.color-swatch, .pen-size-btn, .clear-btn, .nav-btn, .snap-btn, .add-page-btn')) return;

            isDragging = true;

            // Bring to front
            photoZIndex++;
            el.style.zIndex = photoZIndex;

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            startX = clientX;
            startY = clientY;
            initialX = parseFloat(el.style.left) || 0;
            initialY = parseFloat(el.style.top) || 0;

            document.addEventListener('mousemove', onPointerMove);
            document.addEventListener('touchmove', onPointerMove, { passive: false });
            document.addEventListener('mouseup', onPointerUp);
            document.addEventListener('touchend', onPointerUp);
        }

        function onPointerMove(e) {
            if (!isDragging) return;
            e.preventDefault();
            e.stopPropagation();

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const dx = clientX - startX;
            const dy = clientY - startY;

            el.style.left = (initialX + dx) + 'px';
            el.style.top = (initialY + dy) + 'px';
        }

        function onPointerUp(e) {
            isDragging = false;
            document.removeEventListener('mousemove', onPointerMove);
            document.removeEventListener('touchmove', onPointerMove);
            document.removeEventListener('mouseup', onPointerUp);
            document.removeEventListener('touchend', onPointerUp);

            const pageContent = el.closest('.page-content');
            if (pageContent) {
                const canvas = pageContent.querySelector('canvas');
                if (canvas) savePhotosToStorage(canvas.dataset.page);
            }
        }

        el.addEventListener('mousedown', onPointerDown);
        el.addEventListener('touchstart', onPointerDown, { passive: false });
    }

    // ══════════════════════════════════
    // ADD PAGE (dynamic leaf creation)
    // ══════════════════════════════════
    const addPageBtn = document.getElementById('add-page-btn');
    const bookWrap = document.getElementById('book-wrap');
    let nextPageNum = 7; // pages 1-6 already exist

    const stickers = ['⭐', '💕', '🌸', '🐱', '🌙', '☀️', '🦋', '🌈', '🎀', '✏️', '🎵', '🍀', '🌻', '💫', '🐾'];
    const pageStyles = ['page-lines', 'page-dots', 'page-grid'];
    const tapeClasses = [
        'washi-tape tape-corner-r',
        'washi-tape tape-corner-l',
        'washi-tape tape-side',
        'washi-tape tape-top tape-alt',
        'washi-tape tape-corner-r tape-pink',
        'tape-strip'
    ];

    function createDiaryPage(pageNum) {
        const sticker = stickers[Math.floor(Math.random() * stickers.length)];
        const style = pageStyles[Math.floor(Math.random() * pageStyles.length)];
        const tape = tapeClasses[Math.floor(Math.random() * tapeClasses.length)];

        const div = document.createElement('div');
        div.className = 'page-content diary-page';
        div.dataset.page = pageNum;
        div.innerHTML = `
            <div class="page-header">
                <span class="page-date">Page ${pageNum}</span>
                <div class="sticker">${sticker}</div>
            </div>
            <canvas class="draw-canvas" data-page="${pageNum}"></canvas>
            <div class="${style}"></div>
            <div class="${tape}"></div>
        `;
        return div;
    }

    if (addPageBtn) {
        addPageBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            // Save current drawings
            saveAllToStorage();

            // Create a new leaf with two diary pages
            const leaf = document.createElement('div');
            leaf.className = 'leaf';
            leaf.id = 'leaf' + (leaves.length + 1);

            const frontFace = document.createElement('div');
            frontFace.className = 'leaf-face front-face';
            frontFace.appendChild(createDiaryPage(nextPageNum));

            const backFace = document.createElement('div');
            backFace.className = 'leaf-face back-face';
            backFace.appendChild(createDiaryPage(nextPageNum + 1));

            leaf.appendChild(frontFace);
            leaf.appendChild(backFace);

            nextPageNum += 2;

            // Insert before the last leaf (back cover)
            const backCoverLeaf = leaves[leaves.length - 1];
            bookWrap.insertBefore(leaf, backCoverLeaf);

            // Refresh leaves array
            leaves = [...document.querySelectorAll('.leaf')];

            // Re-initialize everything
            current = 0;
            isAnimating = false;
            initStack();
            setTimeout(initDrawCanvases, 300);

            // Brief flash on the button
            addPageBtn.style.background = 'rgba(255,255,255,0.5)';
            setTimeout(() => { addPageBtn.style.background = ''; }, 200);
        });
    }


    // ══════════════════════════════════
    // KEYBOARD & MOBILE DRAW TOGGLE
    // ══════════════════════════════════

    function setDrawingMode(isDrawing) {
        shiftDown = isDrawing;
        if (isDrawing) {
            modeIndicator.classList.add('drawing');
            modeText.textContent = isEraser ? '✋ Erasing...' : '✋ Drawing...';
            if (drawToggleBtn) drawToggleBtn.classList.add('active');
        } else {
            modeIndicator.classList.remove('drawing');
            modeText.textContent = 'Point to move cursor';
            if (drawToggleBtn) drawToggleBtn.classList.remove('active');
        }
    }

    if (drawToggleBtn) {
        // Tap to toggle
        drawToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setDrawingMode(!shiftDown);
        });

        // Or press and hold like a shift key
        drawToggleBtn.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            setDrawingMode(true);
        }, { passive: true });

        drawToggleBtn.addEventListener('touchend', (e) => {
            e.stopPropagation();
            setDrawingMode(false);
        }, { passive: true });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Shift') {
            setDrawingMode(true);
        }
        if (e.code === 'Space') {
            e.preventDefault();
            const pages = getCurrentPageNums();
            if (pages.length > 0) {
                const pc = pageCanvases[pages[0]];
                if (pc) {
                    pc.ctx.clearRect(0, 0, pc.canvas.width, pc.canvas.height);
                    delete drawingData[pages[0]];
                    removePageFromStorage(pages[0]);
                }
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') {
            setDrawingMode(false);
        }
    });


    // ══════════════════════════════════
    // MEDIAPIPE HAND TRACKING
    // ══════════════════════════════════
    const vid = document.getElementById('vid');
    const camCanvas = document.getElementById('camera-canvas');
    const camCtx = camCanvas.getContext('2d');

    // (#8) Set camera canvas size once and on resize, not every frame
    function resizeCamCanvas() {
        camCanvas.width = window.innerWidth;
        camCanvas.height = window.innerHeight;
    }
    resizeCamCanvas();

    // Smoothed cursor position
    let sx = null, sy = null;
    let drawing = false;
    let currentStroke = null;
    let pinching = false;
    let wasPinching = false;

    // Color palette positions (for pinch-to-select on camera canvas)
    const colors = ['#2c1810', '#d63031', '#0984e3', '#00b894', '#6c5ce7', '#fdcb6e', '#e84393'];
    const paletteRadius = 18;
    const paletteGap = 52;
    let hoveredColor = -1;

    function onResults(results) {
        // (#8) Don't resize every frame — just clear
        camCtx.clearRect(0, 0, camCanvas.width, camCanvas.height);

        // Draw camera feed
        camCtx.drawImage(results.image, 0, 0, camCanvas.width, camCanvas.height);

        // Calculate palette positions
        const paletteStartY = (camCanvas.height - (colors.length * paletteGap)) / 2;
        hoveredColor = -1;

        // Draw palette circles on camera canvas
        for (let i = 0; i < colors.length; i++) {
            const px = camCanvas.width - 40;
            const py = paletteStartY + i * paletteGap;
            const isActive = (colors[i] === activeColor && !isEraser);
            let isHover = false;

            if (sx !== null) {
                const d = dist(sx, sy, px, py);
                if (d < paletteRadius + 15) {
                    isHover = true;
                    hoveredColor = i;
                }
            }

            // Draw circle
            camCtx.beginPath();
            camCtx.arc(px, py, paletteRadius + (isHover ? 6 : (isActive ? 4 : 0)), 0, 2 * Math.PI);
            if (isActive) {
                camCtx.strokeStyle = '#FFFFFF';
                camCtx.lineWidth = 3;
                camCtx.stroke();
            } else if (isHover) {
                camCtx.strokeStyle = 'rgba(255,255,255,0.6)';
                camCtx.lineWidth = 2;
                camCtx.stroke();
            }

            camCtx.beginPath();
            camCtx.arc(px, py, paletteRadius, 0, 2 * Math.PI);
            camCtx.fillStyle = colors[i];
            camCtx.fill();
        }

        // Process hand landmarks
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const lm = results.multiHandLandmarks[0];

            // Draw hand skeleton on camera canvas
            drawConnectors(camCtx, lm, HAND_CONNECTIONS, { color: 'rgba(255, 255, 255, 0.25)', lineWidth: 1 });
            drawLandmarks(camCtx, lm, { color: '#FFFFFF', lineWidth: 1, radius: 2 });

            // Index finger tip and thumb tip
            const ind = lm[8];
            const thm = lm[4];
            const rx = ind.x * camCanvas.width;
            const ry = ind.y * camCanvas.height;
            const tx = thm.x * camCanvas.width;
            const ty = thm.y * camCanvas.height;

            // Smooth cursor
            if (sx === null) {
                sx = rx;
                sy = ry;
            } else {
                sx += (rx - sx) * SMOOTHING;
                sy += (ry - sy) * SMOOTHING;
            }

            // Pinch detection
            const pinchDist = dist(tx, ty, rx, ry);
            pinching = pinchDist < PINCH_THRESHOLD;

            // Pinch to select color from camera palette
            if (pinching && !wasPinching && hoveredColor >= 0) {
                activeColor = colors[hoveredColor];
                isEraser = false;
                document.querySelectorAll('.color-swatch').forEach(s => {
                    s.classList.toggle('active', s.dataset.color === activeColor);
                });
            }
            wasPinching = pinching;

            // Draw cursor on camera canvas
            camCtx.beginPath();
            camCtx.arc(sx, sy, 8, 0, 2 * Math.PI);
            camCtx.fillStyle = shiftDown ? activeColor : 'rgba(255, 255, 255, 0.6)';
            camCtx.fill();
            camCtx.strokeStyle = 'rgba(255,255,255,0.8)';
            camCtx.lineWidth = 2;
            camCtx.stroke();

            // Update on-screen finger cursor (mirrored to match camera)
            const cursorScreenX = camCanvas.width - sx;
            const cursorScreenY = sy;
            fingerCursor.style.display = 'block';
            fingerCursor.style.left = cursorScreenX + 'px';
            fingerCursor.style.top = cursorScreenY + 'px';
            if (shiftDown) {
                fingerCursor.style.background = isEraser ? 'rgba(255,255,255,0.5)' : activeColor;
                fingerCursor.style.width = (penSize + 10) + 'px';
                fingerCursor.style.height = (penSize + 10) + 'px';
                fingerCursor.style.borderColor = '#fff';
            } else {
                fingerCursor.style.background = 'rgba(255, 255, 255, 0.3)';
                fingerCursor.style.width = '14px';
                fingerCursor.style.height = '14px';
                fingerCursor.style.borderColor = 'rgba(255,255,255,0.7)';
            }

            // ── DRAWING ON PAGE CANVAS ──
            if (shiftDown && hoveredColor < 0) {
                const pc = getActiveCanvas();
                if (pc) {
                    const bookWrap = document.getElementById('book-wrap');
                    const bookRect = bookWrap.getBoundingClientRect();

                    const mirroredX = camCanvas.width - sx;
                    const mirroredY = sy;

                    const pageX = ((mirroredX - bookRect.left) / bookRect.width) * pc.canvas.width;
                    const pageY = ((mirroredY - bookRect.top) / bookRect.height) * pc.canvas.height;

                    if (pageX >= 0 && pageX <= pc.canvas.width && pageY >= 0 && pageY <= pc.canvas.height) {
                        if (!drawing) {
                            drawing = true;
                            currentStroke = { points: [] };
                        }
                        currentStroke.points.push({ x: pageX, y: pageY });

                        if (currentStroke.points.length >= 2) {
                            const pts = currentStroke.points;
                            const p1 = pts[pts.length - 2];
                            const p2 = pts[pts.length - 1];

                            pc.ctx.lineCap = 'round';
                            pc.ctx.lineJoin = 'round';

                            if (isEraser) {
                                pc.ctx.globalCompositeOperation = 'destination-out';
                                pc.ctx.lineWidth = penSize * 3;
                                pc.ctx.strokeStyle = 'rgba(0,0,0,1)';
                            } else {
                                pc.ctx.globalCompositeOperation = 'source-over';
                                pc.ctx.lineWidth = penSize;
                                pc.ctx.strokeStyle = activeColor;
                                pc.ctx.shadowColor = activeColor;
                                pc.ctx.shadowBlur = 2;
                            }

                            pc.ctx.beginPath();
                            pc.ctx.moveTo(p1.x, p1.y);
                            pc.ctx.lineTo(p2.x, p2.y);
                            pc.ctx.stroke();

                            // (#16) Always reset composite + shadow after drawing
                            pc.ctx.globalCompositeOperation = 'source-over';
                            pc.ctx.shadowColor = 'transparent';
                            pc.ctx.shadowBlur = 0;
                        }
                    }
                }
            } else {
                if (drawing) {
                    drawing = false;
                    currentStroke = null;
                    // Save the page canvas (in-memory + localStorage with debounce)
                    const pages = getCurrentPageNums();
                    pages.forEach(pn => {
                        savePageCanvas(pn);
                        debouncedSaveToStorage(pn);
                    });
                }
            }
        } else {
            // No hand detected
            if (drawing) {
                // Save before losing hand
                const pages = getCurrentPageNums();
                pages.forEach(pn => {
                    savePageCanvas(pn);
                    debouncedSaveToStorage(pn);
                });
            }
            drawing = false;
            currentStroke = null;
            sx = null;
            sy = null;
            fingerCursor.style.display = 'none';
        }
    }


    // ══════════════════════════════════
    // MEDIAPIPE INIT  (#6 — error handling)
    // ══════════════════════════════════
    const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
    });

    hands.onResults(onResults);

    const camera = new Camera(vid, {
        onFrame: async () => { await hands.send({ image: vid }); },
        width: 1280,
        height: 720
    });

    // (#6) Wrap camera start with error handling
    camera.start().catch(err => {
        console.warn('Camera not available:', err);
        // Hide the camera canvas
        camCanvas.style.display = 'none';
        // Show error UI
        if (cameraError) {
            cameraError.style.display = 'flex';
        }
        // Update mode indicator
        if (modeText) {
            modeText.textContent = 'Camera unavailable — book only';
        }
    });


    // ══════════════════════════════════
    // HELPERS
    // ══════════════════════════════════
    function getClientX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }
    function dist(x1, y1, x2, y2) {
        return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
    }

    // ══════════════════════════════════
    // INIT
    // ══════════════════════════════════
    initStack();

    // Init canvases after a short delay (let layout settle)
    setTimeout(initDrawCanvases, 300);

    // Re-init canvases on resize
    window.addEventListener('resize', () => {
        // (#8) Resize camera canvas here instead of every frame
        resizeCamCanvas();

        // Save all before resize
        Object.keys(pageCanvases).forEach(savePageCanvas);
        setTimeout(initDrawCanvases, 100);
    });

    // Save to localStorage before page unload
    window.addEventListener('beforeunload', saveAllToStorage);

});
