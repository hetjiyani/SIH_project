/**
 * AgriSmart AI - Application Controller
 * Vanilla JavaScript (No bundler, No frameworks)
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // State Management
  const state = {
    activeSection: 'section-disease',
    selectedImageFile: null,
    selectedSamplePreset: null,
    currentLanguage: 'en',
    currentCropRecs: null,
    currentWeather: null,
    currentIrrigation: null,
    agenticEvents: [],
    activeAgentFilter: 'all',
    currentLocation: {
      name: 'Surat',
      displayName: 'Surat, Gujarat',
      lat: 21.1981,
      lon: 72.8298,
      source: 'Auto IP Network'
    }
  };

  /* ==========================================================
     0. Live Location Tracking & Multi-Module Sync Controller
     ========================================================== */
  const headerLocationBtn = document.getElementById('headerLocationBtn');
  const headerLocationText = document.getElementById('headerLocationText');
  const headerWeatherVal = document.getElementById('headerWeatherVal');
  const headerMoistureVal = document.getElementById('headerMoistureVal');
  const locationInput = document.getElementById('locationInput');
  const detectGpsBtn = document.getElementById('detectGpsBtn');
  const locationStatusBadge = document.getElementById('locationStatusBadge');
  const weatherHeroLocation = document.getElementById('weatherHeroLocation');
  const phInput = document.getElementById('phInput');
  const phDisplay = document.getElementById('phDisplay');
  const moistureInput = document.getElementById('moistureInput');
  const moistureDisplay = document.getElementById('moistureDisplay');
  const tempInput = document.getElementById('tempInput');
  const tempDisplay = document.getElementById('tempDisplay');
  const rainProbInput = document.getElementById('rainProbInput');
  const rainProbDisplay = document.getElementById('rainProbDisplay');

  // Broadcast location update across all full-stack modules
  async function applyLocationUpdate(locationObj, isUserGesture = false) {
    if (!locationObj) return;
    state.currentLocation = locationObj;
    window.currentFarmLocation = locationObj;

    // 1. Update UI Elements
    if (headerLocationText) {
      headerLocationText.textContent = locationObj.displayName || `${locationObj.lat.toFixed(2)}°N, ${locationObj.lon.toFixed(2)}°E`;
    }
    if (locationInput) {
      locationInput.value = locationObj.displayName;
    }
    if (weatherHeroLocation) {
      weatherHeroLocation.textContent = `Station: ${locationObj.displayName} (${locationObj.lat.toFixed(2)}°N, ${locationObj.lon.toFixed(2)}°E) • Live Telemetry`;
    }
    if (locationStatusBadge) {
      const isGps = locationObj.source && locationObj.source.includes('GPS');
      locationStatusBadge.textContent = isGps ? '● Live GPS Active' : '● Auto Network Active';
      locationStatusBadge.style.color = '#2E7D32';
    }

    if (isUserGesture) {
      showToast(`Location set to ${locationObj.displayName}`, 'success');
    }

    // 2. Fetch and render Live Weather for exact coordinates
    await loadWeatherAdvice(locationObj.displayName, locationObj.lat, locationObj.lon);

    // 3. Sync Disease Form sliders to live ambient values
    if (state.currentWeather && state.currentWeather.current) {
      const curTemp = Math.round(state.currentWeather.current.temp);
      const curRain = state.currentWeather.current.rainProb;
      if (tempInput) {
        tempInput.value = curTemp;
        const tempDisplay = document.getElementById('tempDisplay');
        if (tempDisplay) tempDisplay.textContent = `${curTemp}°C`;
      }
      if (rainProbInput) {
        rainProbInput.value = curRain;
        const rainProbDisplay = document.getElementById('rainProbDisplay');
        if (rainProbDisplay) rainProbDisplay.textContent = `${curRain}%`;
      }
      if (headerWeatherVal) {
        headerWeatherVal.textContent = `${curTemp}°C • Rain ${curRain}%`;
      }
    }

    // 4. Recalculate Smart Irrigation based on local weather & coordinates
    await loadIrrigationAdvice();

    // 5. Update Crop Recommendations context for current location
    if (!state.cropSelectedLocation) {
      await loadCropRecommendations();
    }
  }

  // Trigger high-precision GPS detection
  async function detectGpsLocation() {
    if (locationStatusBadge) {
      locationStatusBadge.textContent = '● Acquiring GPS Satellite Lock...';
      locationStatusBadge.style.color = '#E65100';
    }
    showToast('Acquiring high-precision GPS coordinates...', 'info');

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          try {
            const rev = await window.AgriSmartAPI.reverseGeocodeLocation(lat, lon);
            const locObj = {
              name: rev.city || 'My Farm',
              displayName: rev.display_name || `${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E`,
              lat: lat,
              lon: lon,
              source: 'High-Precision GPS'
            };
            await applyLocationUpdate(locObj, true);
          } catch (e) {
            const locObj = {
              name: 'GPS Station',
              displayName: `${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E`,
              lat: lat,
              lon: lon,
              source: 'High-Precision GPS'
            };
            await applyLocationUpdate(locObj, true);
          }
        },
        async (err) => {
          console.warn('GPS permission denied or unavailable:', err.message);
          showToast('GPS access denied. Falling back to live network IP detection...', 'warning');
          await autoDetectIpLocation(true);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    } else {
      showToast('Geolocation not supported by browser. Using live IP location.', 'warning');
      await autoDetectIpLocation(true);
    }
  }

  // Auto-detect location via IP
  async function autoDetectIpLocation(notify = false) {
    try {
      const ipLoc = await window.AgriSmartAPI.detectCurrentLocation();
      const locObj = {
        name: ipLoc.city,
        displayName: ipLoc.display_name || `${ipLoc.city}, ${ipLoc.state}`,
        lat: ipLoc.latitude,
        lon: ipLoc.longitude,
        source: ipLoc.source || 'Auto Network IP'
      };
      await applyLocationUpdate(locObj, notify);
    } catch (e) {
      console.warn('Auto IP location failed:', e);
    }
  }

  // Bind location interaction listeners
  if (detectGpsBtn) {
    detectGpsBtn.addEventListener('click', () => {
      detectGpsLocation();
    });
  }

  if (headerLocationBtn) {
    headerLocationBtn.addEventListener('click', () => {
      detectGpsLocation();
    });
  }

  if (locationInput) {
    locationInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = locationInput.value.trim();
        if (!query) return;
        showToast(`Locating "${query}"...`, 'info');
        const res = await window.AgriSmartAPI.searchLocation(query);
        if (res) {
          const locObj = {
            name: res.name || query,
            displayName: res.display_name || query,
            lat: res.latitude,
            lon: res.longitude,
            source: 'Manual Search'
          };
          await applyLocationUpdate(locObj, true);
        }
      }
    });
  }

  // Quick preset chips
  document.querySelectorAll('.loc-preset-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const locStr = chip.getAttribute('data-loc');
      if (!locStr) return;
      showToast(`Switching location to ${locStr}...`, 'info');
      const res = await window.AgriSmartAPI.searchLocation(locStr);
      if (res) {
        const locObj = {
          name: res.name || locStr,
          displayName: res.display_name || locStr,
          lat: res.latitude,
          lon: res.longitude,
          source: 'Quick Preset'
        };
        await applyLocationUpdate(locObj, true);
      }
    });
  });

  /* ==========================================================
     1. Tab Navigation Controller
     ========================================================== */
  const navButtons = document.querySelectorAll('.nav-btn');
  const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
  const sections = document.querySelectorAll('.app-section');
  const navToggleBtn = document.getElementById('navToggleBtn');
  const navWrapper = document.querySelector('.nav-wrapper');

  function switchSection(targetSectionId) {
    if (!targetSectionId) return;

    // Update section active state
    sections.forEach(sec => {
      const isTarget = sec.id === targetSectionId;
      sec.classList.toggle('active', isTarget);
      sec.setAttribute('aria-hidden', !isTarget);
    });

    // Update desktop nav buttons
    navButtons.forEach(btn => {
      const isTarget = btn.getAttribute('data-section') === targetSectionId;
      btn.classList.toggle('active', isTarget);
      btn.setAttribute('aria-selected', isTarget);
    });

    // Update mobile nav buttons
    mobileNavItems.forEach(btn => {
      const isTarget = btn.getAttribute('data-section') === targetSectionId;
      btn.classList.toggle('active', isTarget);
    });

    state.activeSection = targetSectionId;
    window.location.hash = targetSectionId;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Lazy load section data on first navigation
    handleSectionActivation(targetSectionId);
  }

  // Desktop navigation click
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const sectionId = btn.getAttribute('data-section');
      switchSection(sectionId);
    });
  });

  // Mobile bottom bar click
  mobileNavItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const sectionId = btn.getAttribute('data-section');
      switchSection(sectionId);
    });
  });

  // Header Brand click
  const brandHomeLink = document.getElementById('brandHomeLink');
  if (brandHomeLink) {
    brandHomeLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchSection('section-disease');
    });
  }

  // Mobile toggle button for desktop nav bar
  if (navToggleBtn && navWrapper) {
    navToggleBtn.addEventListener('click', () => {
      const isExpanded = navToggleBtn.getAttribute('aria-expanded') === 'true';
      navToggleBtn.setAttribute('aria-expanded', !isExpanded);
      navWrapper.style.display = isExpanded ? 'none' : 'block';
    });
  }


  /* ==========================================================
     2. Form Telemetry Sliders & Display Binding
     ========================================================== */
  if (phInput && phDisplay) {
    phInput.addEventListener('input', () => {
      phDisplay.textContent = `${phInput.value} pH`;
    });
  }

  if (moistureInput && moistureDisplay) {
    moistureInput.addEventListener('input', () => {
      moistureDisplay.textContent = `${moistureInput.value}%`;
      if (headerMoistureVal) headerMoistureVal.innerHTML = `Moisture: <strong>${moistureInput.value}%</strong>`;
    });
  }

  if (tempInput && tempDisplay) {
    tempInput.addEventListener('input', () => {
      tempDisplay.textContent = `${tempInput.value}°C`;
      updateHeaderWeather();
    });
  }

  if (rainProbInput && rainProbDisplay) {
    rainProbInput.addEventListener('input', () => {
      rainProbDisplay.textContent = `${rainProbInput.value}%`;
      updateHeaderWeather();
    });
  }

  function updateHeaderWeather() {
    if (headerWeatherVal && tempInput && rainProbInput) {
      headerWeatherVal.textContent = `${tempInput.value}°C • Rain ${rainProbInput.value}%`;
    }
  }

  /* ==========================================================
     3. Leaf Image Upload & Dropzone Controller
     ========================================================== */
  const leafDropzone = document.getElementById('leafDropzone');
  const leafFileInput = document.getElementById('leafFileInput');
  const imagePreviewCard = document.getElementById('imagePreviewCard');
  const previewThumbnailWrap = document.getElementById('previewThumbnailWrap');
  const previewFilename = document.getElementById('previewFilename');
  const previewMeta = document.getElementById('previewMeta');
  const previewRemoveBtn = document.getElementById('previewRemoveBtn');
  const samplePresetsContainer = document.getElementById('samplePresetsContainer');

  // Drag and drop events
  ['dragenter', 'dragover'].forEach(eventName => {
    leafDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      leafDropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    leafDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      leafDropzone.classList.remove('dragover');
    });
  });

  leafDropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      handleImageFileSelected(files[0]);
    }
  });

  leafFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleImageFileSelected(e.target.files[0]);
    }
  });

  function handleImageFileSelected(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file (JPEG, PNG, WebP)', 'warning');
      return;
    }

    state.selectedImageFile = file;
    state.selectedSamplePreset = null;
    clearActiveSampleChips();

    // Generate local preview
    const reader = new FileReader();
    reader.onload = (e) => {
      previewThumbnailWrap.innerHTML = `<img src="${e.target.result}" alt="Uploaded Leaf Preview" class="preview-thumbnail">`;
      previewFilename.textContent = file.name;
      previewMeta.textContent = `${(file.size / 1024).toFixed(1)} KB • Ready for pathology scan`;
      imagePreviewCard.classList.add('visible');
    };
    reader.readAsDataURL(file);
    showToast(`Loaded ${file.name}`, 'info');
  }

  // Remove preview
  if (previewRemoveBtn) {
    previewRemoveBtn.addEventListener('click', () => {
      state.selectedImageFile = null;
      state.selectedSamplePreset = null;
      leafFileInput.value = '';
      imagePreviewCard.classList.remove('visible');
      clearActiveSampleChips();
    });
  }

  // Sample Leaf Presets Controller
  function clearActiveSampleChips() {
    document.querySelectorAll('.sample-chip').forEach(c => c.classList.remove('active'));
  }

  if (samplePresetsContainer) {
    samplePresetsContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.sample-chip');
      if (!chip) return;

      const presetKey = chip.getAttribute('data-preset');
      const preset = window.AgriSmartMock.SAMPLE_LEAF_PRESETS[presetKey];
      if (!preset) return;

      clearActiveSampleChips();
      chip.classList.add('active');

      state.selectedSamplePreset = presetKey;
      state.selectedImageFile = { name: preset.imageLabel, isPreset: true, presetKey };

      const sampleImgUrl = `assets/samples/${presetKey}.jpg`;
      fetch(sampleImgUrl)
        .then(res => {
          if (!res.ok) throw new Error('Specimen image not found');
          return res.blob();
        })
        .then(blob => {
          state.selectedImageFile = new File([blob], `${presetKey}.jpg`, { type: 'image/jpeg' });
        })
        .catch(err => {
          console.warn('Using specimen placeholder:', err);
        });

      // Auto-fill farm context form from preset
      const cropSelect = document.getElementById('cropTypeSelect');
      const stageSelect = document.getElementById('growthStageSelect');
      const soilSelect = document.getElementById('soilTypeSelect');
      const locInput = document.getElementById('locationInput');

      if (cropSelect) cropSelect.value = preset.crop;
      if (stageSelect) stageSelect.value = preset.stage;
      if (soilSelect) soilSelect.value = preset.soil;
      if (locInput) locInput.value = preset.location;

      if (phInput) {
        phInput.value = preset.ph;
        phDisplay.textContent = `${preset.ph} pH`;
      }
      if (moistureInput) {
        moistureInput.value = preset.moisture;
        moistureDisplay.textContent = `${preset.moisture}%`;
        if (headerMoistureVal) headerMoistureVal.innerHTML = `Moisture: <strong>${preset.moisture}%</strong>`;
      }
      if (tempInput) {
        tempInput.value = preset.temp;
        tempDisplay.textContent = `${preset.temp}°C`;
      }
      if (rainProbInput) {
        rainProbInput.value = preset.rainProb;
        rainProbDisplay.textContent = `${preset.rainProb}%`;
      }
      updateHeaderWeather();

      // Show sample preview photo with SVG fallback
      previewThumbnailWrap.innerHTML = `<img src="${sampleImgUrl}" alt="${preset.name}" class="preview-thumbnail" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
      previewFilename.textContent = `${preset.name} (Live Specimen)`;
      previewMeta.textContent = `${preset.crop} • Auto-calibrated test photo • Ready for ML scan`;
      imagePreviewCard.classList.add('visible');

      showToast(`Selected ${preset.name} test sample`, 'success');
    });
  }

  function generateSampleLeafSVG(svgType, isDiseased) {
    const strokeColor = isDiseased ? '#E65100' : '#2E7D32';
    const fillColor = isDiseased ? '#FFF3E0' : '#E8F5E9';
    return `
      <svg viewBox="0 0 100 100" width="70" height="70" aria-hidden="true">
        <path d="M50 10 C25 25 15 55 50 90 C85 55 75 25 50 10 Z" fill="${fillColor}" stroke="${strokeColor}" stroke-width="3"/>
        <line x1="50" y1="15" x2="50" y2="85" stroke="${strokeColor}" stroke-width="2.5"/>
        <line x1="50" y1="35" x2="35" y2="45" stroke="${strokeColor}" stroke-width="1.8"/>
        <line x1="50" y1="48" x2="65" y2="58" stroke="${strokeColor}" stroke-width="1.8"/>
        <line x1="50" y1="62" x2="38" y2="70" stroke="${strokeColor}" stroke-width="1.8"/>
        ${isDiseased ? `
          <circle cx="40" cy="38" r="6" fill="#D32F2F" opacity="0.85"/>
          <circle cx="58" cy="52" r="8" fill="#D32F2F" opacity="0.85"/>
          <circle cx="44" cy="65" r="5" fill="#E65100" opacity="0.85"/>
        ` : `
          <circle cx="50" cy="50" r="4" fill="#66BB6A" opacity="0.6"/>
        `}
      </svg>
    `;
  }

  /* ==========================================================
     4. Disease Detection Analysis Handler
     ========================================================== */
  const farmContextForm = document.getElementById('farmContextForm');
  const diseaseLoadingOverlay = document.getElementById('diseaseLoadingOverlay');
  const analyzeBtn = document.getElementById('analyzeBtn');

  if (farmContextForm) {
    farmContextForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await runDiseaseAnalysis();
    });
  }

  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await runDiseaseAnalysis();
    });
  }

  async function runDiseaseAnalysis() {
    const cropType = document.getElementById('cropTypeSelect')?.value || 'Tomato';
    const growthStage = document.getElementById('growthStageSelect')?.value || 'Fruiting';
    const soilType = document.getElementById('soilTypeSelect')?.value || 'Loamy';
    const ph = parseFloat(phInput?.value) || 6.4;
    const soilMoisture = parseInt(moistureInput?.value) || 68;
    const temperature = parseInt(tempInput?.value) || 27;
    const rainProb = parseInt(rainProbInput?.value) || 65;
    const location = document.getElementById('locationInput')?.value || 'Nashik Valley, MH';

    const isHealthyPreset = state.selectedSamplePreset === 'corn_healthy';

    const farmContext = {
      cropType,
      growthStage,
      soilType,
      ph,
      soilMoisture,
      temperature,
      rainProb,
      location,
      isHealthyPreset
    };

    // Show loading spinner
    if (diseaseLoadingOverlay) diseaseLoadingOverlay.classList.add('active');
    if (analyzeBtn) analyzeBtn.disabled = true;

    try {
      const result = await window.AgriSmartAPI.predictDisease(
        state.selectedImageFile || { name: 'sample_leaf.jpg' },
        farmContext
      );
      renderDiseaseResult(result);
      if (result.status === 'invalid_image') {
        const isImproper = (result.reason === 'improper_image' || result.reason === 'low_confidence');
        const toastMsg = isImproper
          ? 'The image is not proper (Confidence below 50%). Please upload a clear crop leaf photo.'
          : (result.retry_message || 'Image rejected: Please upload a crop leaf photo to retry');
        showToast(toastMsg, 'warning');
      } else {
        showToast(`Analysis complete: ${result.disease}`, result.status === 'healthy' ? 'success' : 'warning');
      }
    } catch (err) {
      console.error('Disease prediction error:', err);
      showToast('Error during disease diagnosis: ' + err.message, 'warning');
    } finally {
      if (diseaseLoadingOverlay) diseaseLoadingOverlay.classList.remove('active');
      if (analyzeBtn) analyzeBtn.disabled = false;
    }
  }

  function renderDiseaseResult(result) {
    const diseaseResultDetails = document.getElementById('diseaseResultDetails');
    const diseaseValidationCard = document.getElementById('diseaseValidationCard');

    // 1. Guardrail Check: Rejected / Non-Plant / Improper Image (< 50% confidence)
    if (result.status === 'invalid_image') {
      if (diseaseResultDetails) diseaseResultDetails.style.display = 'none';
      if (diseaseValidationCard) {
        diseaseValidationCard.style.display = 'flex';

        const valBadge = document.getElementById('validationBadge');
        const valTitle = document.getElementById('validationTitle');
        const valSubtitle = document.getElementById('validationSubtitle');
        const valFoliage = document.getElementById('validationFoliageRatio');
        const valReason = document.getElementById('validationReasonText');
        const valMessage = document.getElementById('validationDetailMessage');
        const valRetryMessage = document.getElementById('validationRetryMessage');
        const valTipsList = document.getElementById('validationTipsList');

        if (valBadge) {
          if (result.reason === 'improper_image' || result.reason === 'low_confidence') {
            valBadge.textContent = '⚠️ Image Not Proper • Confidence Below 50%';
            valBadge.style.backgroundColor = '#FFEBEE';
            valBadge.style.color = '#C62828';
          } else if (result.reason === 'no_plant_detected') {
            valBadge.textContent = '❌ Guardrail Alert • Non-Crop Image Detected';
            valBadge.style.backgroundColor = '#FFCDD2';
            valBadge.style.color = '#B71C1C';
          } else if (result.reason === 'monotone_or_blank') {
            valBadge.textContent = '⚠️ Quality Notice • Blank / Low Contrast Image';
            valBadge.style.backgroundColor = '#FFE082';
            valBadge.style.color = '#795548';
          } else {
            valBadge.textContent = '⚠️ Image Rejected • Not Proper for Diagnosis';
            valBadge.style.backgroundColor = '#FFE082';
            valBadge.style.color = '#795548';
          }
        }

        if (valTitle) valTitle.textContent = result.title || 'Image is Not Proper';
        if (valSubtitle) {
          valSubtitle.textContent = result.message || 'The uploaded image is not proper or lacks recognizable crop foliage.';
        }
        if (valFoliage) {
          const ratio = (result.vegetation_ratio !== undefined)
            ? (result.vegetation_ratio <= 1.0 ? (result.vegetation_ratio * 100).toFixed(1) : result.vegetation_ratio.toFixed(1))
            : '0.0';
          valFoliage.textContent = `${ratio}%`;
        }
        if (valReason) {
          const reasons = {
            'improper_image': 'Image Not Proper (Confidence < 50%)',
            'low_confidence': 'Image Not Proper (Confidence < 50%)',
            'no_plant_detected': 'Non-Crop / Out-of-Domain Image',
            'monotone_or_blank': 'Monotone / Blank Frame',
            'too_small': 'Resolution Too Low (< 40x40)',
            'empty_file': 'Corrupt / Empty Image',
          };
          valReason.textContent = reasons[result.reason] || 'Guardrail Triggered';
        }
        if (valMessage) {
          valMessage.textContent = result.message || 'The image does not contain recognizable plant foliage or foliar lesions.';
        }
        if (valRetryMessage) {
          valRetryMessage.textContent = result.retry_message || 'Please retry by uploading or capturing a clear close-up photograph of an agricultural crop leaf in bright natural daylight.';
        }
        if (valTipsList && result.suggestions && result.suggestions.length > 0) {
          valTipsList.innerHTML = result.suggestions.map((sug, i) => {
            const icons = ['🌿', '☀️', '🎯', '🌾'];
            return `<li><span class="tip-icon">${icons[i % icons.length]}</span><div><strong>Tip ${i+1}:</strong> ${sug}</div></li>`;
          }).join('');
        }

        diseaseValidationCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }

    // 2. Verified Leaf: Show Diagnosis Details
    if (diseaseValidationCard) diseaseValidationCard.style.display = 'none';
    if (diseaseResultDetails) diseaseResultDetails.style.display = 'block';

    const statusBadge = document.getElementById('resStatusBadge');
    const statusText = document.getElementById('resStatusText');
    const diseaseName = document.getElementById('resDiseaseName');
    const scientificName = document.getElementById('resScientificName');
    const severityTag = document.getElementById('resSeverityTag');
    const confidenceVal = document.getElementById('resConfidenceVal');
    const confidenceBar = document.getElementById('resConfidenceBar');
    const summaryText = document.getElementById('resSummaryText');
    const symptomsList = document.getElementById('resSymptomsList');
    const organicAdvice = document.getElementById('resOrganicAdvice');
    const culturalAdvice = document.getElementById('resCulturalAdvice');
    const chemicalAdvice = document.getElementById('resChemicalAdvice');

    if (diseaseName) diseaseName.textContent = result.disease;
    if (scientificName) scientificName.textContent = `${result.scientificName} • Diagnostic Confidence Matrix`;
    if (summaryText) summaryText.textContent = result.summary;

    if (confidenceVal) confidenceVal.textContent = `${result.confidence}%`;
    if (confidenceBar) {
      confidenceBar.style.width = '0%';
      setTimeout(() => {
        confidenceBar.style.width = `${result.confidence}%`;
      }, 50);
    }

    if (statusBadge && statusText) {
      if (result.status === 'healthy') {
        statusBadge.className = 'result-status-badge healthy';
        statusText.textContent = 'Healthy Foliage';
        if (severityTag) {
          severityTag.textContent = 'Optimal Plant Health';
          severityTag.style.background = 'var(--color-success-bg)';
          severityTag.style.color = 'var(--color-success)';
        }
      } else {
        statusBadge.className = 'result-status-badge diseased';
        statusText.textContent = 'Pathogen Detected';
        if (severityTag) {
          severityTag.textContent = result.severity;
          severityTag.style.background = 'var(--color-warning-bg)';
          severityTag.style.color = 'var(--color-warning)';
        }
      }
    }

    if (symptomsList && result.symptoms) {
      symptomsList.innerHTML = result.symptoms.map(sym => `
        <li>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <span>${sym}</span>
        </li>
      `).join('');
    }

    if (result.precautions) {
      if (organicAdvice) organicAdvice.innerHTML = `<strong>Organic / Biological:</strong> ${result.precautions.organic || 'Maintain balanced nutrition.'}`;
      if (culturalAdvice) culturalAdvice.innerHTML = `<strong>Cultural Practice:</strong> ${result.precautions.cultural || 'Ensure aeration and sanitation.'}`;
      if (chemicalAdvice) {
        if (result.precautions.chemical) {
          chemicalAdvice.parentElement.style.display = 'flex';
          chemicalAdvice.innerHTML = `<strong>Chemical Option (If severe):</strong> ${result.precautions.chemical}`;
        } else {
          chemicalAdvice.parentElement.style.display = 'none';
        }
      }
    }

    // Render Real Model Differentials & Model Badge
    const top3Container = document.getElementById('resTop3Container');
    const top3List = document.getElementById('resTop3List');
    const modelBadge = document.getElementById('resModelBadge');

    if (top3Container && top3List) {
      if (result.top_3 && result.top_3.length > 0) {
        top3Container.style.display = 'block';
        if (modelBadge) {
          modelBadge.textContent = (result.model_mode === 'real')
            ? '⚡ Real PyTorch Model (38 Classes)'
            : '🧪 Simulated Mode';
        }
        top3List.innerHTML = result.top_3.map((item, idx) => `
          <span style="background: rgba(46,125,50,0.07); border: 1px solid var(--color-border); padding: 4px 10px; border-radius: 6px; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 4px;">
            <strong style="color: var(--color-primary);">${idx + 1}.</strong> ${item.display_name}: <strong>${item.confidence}%</strong>
          </span>
        `).join('');
      } else {
        top3Container.style.display = 'none';
      }
    }
  }

  // Action buttons on the Validation Warning Card
  const validationRetakeBtn = document.getElementById('validationRetakeBtn');
  if (validationRetakeBtn) {
    validationRetakeBtn.addEventListener('click', () => {
      const fileInput = document.getElementById('leafFileInput');
      if (fileInput) {
        fileInput.value = '';
        fileInput.click();
      }
      const dropzone = document.getElementById('leafDropzone');
      if (dropzone) dropzone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  const validationTrySampleBtn = document.getElementById('validationTrySampleBtn');
  if (validationTrySampleBtn) {
    validationTrySampleBtn.addEventListener('click', () => {
      const tomatoChip = document.querySelector('.sample-chip[data-preset="tomato_blight"]');
      if (tomatoChip) {
        tomatoChip.click();
        const analyzeBtn = document.getElementById('analyzeBtn');
        if (analyzeBtn) setTimeout(() => analyzeBtn.click(), 120);
      }
    });
  }

  // Cross-navigation buttons from Disease Results
  const askAssistantAboutDiseaseBtn = document.getElementById('askAssistantAboutDiseaseBtn');
  if (askAssistantAboutDiseaseBtn) {
    askAssistantAboutDiseaseBtn.addEventListener('click', () => {
      const disease = document.getElementById('resDiseaseName')?.textContent || 'Early Blight';
      switchSection('section-assistant');
      const chatInput = document.getElementById('chatInputField');
      if (chatInput) {
        chatInput.value = `How should I manage ${disease} organically on my farm?`;
        document.getElementById('chatInputForm')?.dispatchEvent(new Event('submit'));
      }
    });
  }

  const checkIrrigationFromDiseaseBtn = document.getElementById('checkIrrigationFromDiseaseBtn');
  if (checkIrrigationFromDiseaseBtn) {
    checkIrrigationFromDiseaseBtn.addEventListener('click', () => {
      switchSection('section-irrigation');
    });
  }

  /* ==========================================================
     5. Crop Recommendation Controller (Location & Climate Aware)
     ========================================================= */
  const refreshCropRecsBtn = document.getElementById('refreshCropRecsBtn');
  const cropRecommendationsList = document.getElementById('cropRecommendationsList');
  const cropRecSoilSummary = document.getElementById('cropRecSoilSummary');
  const cropActiveLocationName = document.getElementById('cropActiveLocationName');
  const cropLocationModeBadge = document.getElementById('cropLocationModeBadge');
  const cropUseLiveLocationBtn = document.getElementById('cropUseLiveLocationBtn');
  const cropRegionPresetSelect = document.getElementById('cropRegionPresetSelect');
  const cropCustomLocationInput = document.getElementById('cropCustomLocationInput');
  const cropApplyCustomLocBtn = document.getElementById('cropApplyCustomLocBtn');
  const cropRecZoneName = document.getElementById('cropRecZoneName');

  async function loadCropRecommendations() {
    if (!cropRecommendationsList) return;

    // Determine whether user is using a custom selected location or the live/current location
    const isCustomSelected = Boolean(state.cropSelectedLocation);
    const activeLoc = state.cropSelectedLocation || state.currentLocation;
    const locName = activeLoc?.displayName || activeLoc?.name || document.getElementById('locationInput')?.value || 'Surat, Gujarat';
    const locLat = activeLoc?.lat;
    const locLon = activeLoc?.lon;

    // Update the UI header in the Crop Recommendation card
    if (cropActiveLocationName) {
      cropActiveLocationName.textContent = locName;
    }
    if (cropLocationModeBadge) {
      if (isCustomSelected) {
        cropLocationModeBadge.textContent = '📍 Custom Selected Location';
        cropLocationModeBadge.style.background = '#E3F2FD';
        cropLocationModeBadge.style.color = '#1565C0';
        cropLocationModeBadge.style.border = '1px solid #90CAF9';
      } else {
        const isGps = activeLoc?.source && activeLoc.source.includes('GPS');
        cropLocationModeBadge.textContent = isGps ? '● Live GPS Detected' : '● Live Auto-Detected';
        cropLocationModeBadge.style.background = '#E8F5E9';
        cropLocationModeBadge.style.color = '#2E7D32';
        cropLocationModeBadge.style.border = '1px solid #A5D6A7';
      }
    }

    const soilData = {
      ph: phInput?.value || 6.4,
      moisture: moistureInput?.value || 68,
      temperature: tempInput?.value || 27,
      rainProb: rainProbInput?.value || 65,
      soilType: document.getElementById('soilTypeSelect')?.value || 'Loamy',
      location: locName,
      lat: locLat,
      lon: locLon
    };

    if (cropRecSoilSummary) {
      cropRecSoilSummary.textContent = `${soilData.soilType} Soil • pH ${soilData.ph} • Moisture ${soilData.moisture}% • ${soilData.temperature}°C`;
    }

    try {
      const data = await window.AgriSmartAPI.recommendCrop(soilData);
      state.currentCropRecs = data;

      if (cropRecZoneName && data.zone_name) {
        cropRecZoneName.textContent = data.zone_name;
      }

      renderCropRecommendations(data.recommendations, data);
    } catch (err) {
      console.error('Crop recommendation error:', err);
    }
  }

  function renderCropRecommendations(crops, meta = {}) {
    if (!cropRecommendationsList || !crops) return;

    cropRecommendationsList.innerHTML = crops.map(crop => {
      const isStar = crop.isRegionalStar || crop.regionalBadge?.includes('Flagship') || crop.regionalBadge?.includes('Star');
      const badgeHtml = crop.regionalBadge ? `
        <span class="crop-regional-pill" title="Tailored to local agro-climatic zone">
          ${crop.regionalBadge}
        </span>
      ` : '';

      return `
      <article class="crop-rank-card ${isStar ? 'crop-card-regional-star' : ''}" aria-label="${crop.name} Rank ${crop.rank}">
        <div class="crop-card-top">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div class="crop-rank-badge ${isStar ? 'star-badge' : ''}">#${crop.rank}</div>
            <div class="crop-name-wrap">
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <h3>${crop.name}</h3>
                ${badgeHtml}
              </div>
              <p style="font-size: 0.85rem; font-style: italic; color: var(--color-text-light);">${crop.botanicalName}</p>
            </div>
          </div>
          <div class="crop-match-pill">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14" aria-hidden="true">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            <span>${crop.matchScore}% Suitability</span>
          </div>
        </div>

        <div class="crop-metrics-strip">
          <div class="crop-metric-item">
            <span class="crop-metric-label">Water Need</span>
            <span class="crop-metric-val">${crop.waterRequirement}</span>
          </div>
          <div class="crop-metric-item">
            <span class="crop-metric-label">Cycle Time</span>
            <span class="crop-metric-val">${crop.harvestDuration}</span>
          </div>
          <div class="crop-metric-item">
            <span class="crop-metric-label">Est. Yield</span>
            <span class="crop-metric-val">${crop.expectedYield}</span>
          </div>
          <div class="crop-metric-item">
            <span class="crop-metric-label">Market Value</span>
            <span class="crop-metric-val" style="color: var(--color-primary);">${crop.profitPotential}</span>
          </div>
        </div>

        <p class="crop-rationale">${crop.rationale}</p>
        <div style="font-size: 0.85rem; font-weight: 700; color: var(--color-primary);">
          Key Advantage: <span style="font-weight: normal; color: var(--color-text-main);">${crop.keyAdvantage}</span>
        </div>
      </article>
      `;
    }).join('');
  }

  // Bind Crop Location Controls
  if (cropUseLiveLocationBtn) {
    cropUseLiveLocationBtn.addEventListener('click', async () => {
      state.cropSelectedLocation = null;
      if (cropRegionPresetSelect) cropRegionPresetSelect.value = 'CURRENT';
      if (cropCustomLocationInput) cropCustomLocationInput.value = '';
      showToast('Acquiring live GPS / network location for crop matching...', 'info');
      await detectGpsLocation();
      await loadCropRecommendations();
    });
  }

  if (cropRegionPresetSelect) {
    cropRegionPresetSelect.addEventListener('change', async () => {
      const selectedVal = cropRegionPresetSelect.value;
      if (selectedVal === 'CURRENT') {
        state.cropSelectedLocation = null;
        showToast('Switched crop engine to current live location', 'info');
        await loadCropRecommendations();
        return;
      }
      showToast(`Evaluating crops for ${selectedVal}...`, 'info');
      try {
        const geocoded = await window.AgriSmartAPI.searchLocation(selectedVal);
        if (geocoded) {
          state.cropSelectedLocation = {
            name: geocoded.name || selectedVal,
            displayName: geocoded.display_name || selectedVal,
            lat: geocoded.latitude,
            lon: geocoded.longitude,
            source: 'Preset Region'
          };
        } else {
          state.cropSelectedLocation = {
            name: selectedVal,
            displayName: selectedVal,
            source: 'Preset Region'
          };
        }
      } catch (err) {
        state.cropSelectedLocation = {
          name: selectedVal,
          displayName: selectedVal,
          source: 'Preset Region'
        };
      }
      await loadCropRecommendations();
      showToast(`Crops matched for ${selectedVal}`, 'success');
    });
  }

  async function applyCustomCropLocation() {
    if (!cropCustomLocationInput) return;
    const query = cropCustomLocationInput.value.trim();
    if (!query) return;

    showToast(`Locating agricultural zone for "${query}"...`, 'info');
    try {
      const geocoded = await window.AgriSmartAPI.searchLocation(query);
      if (geocoded) {
        state.cropSelectedLocation = {
          name: geocoded.name || query,
          displayName: geocoded.display_name || query,
          lat: geocoded.latitude,
          lon: geocoded.longitude,
          source: 'Custom Selected'
        };
      } else {
        state.cropSelectedLocation = {
          name: query,
          displayName: query,
          source: 'Custom Selected'
        };
      }
    } catch (err) {
      state.cropSelectedLocation = {
        name: query,
        displayName: query,
        source: 'Custom Selected'
      };
    }
    if (cropRegionPresetSelect) cropRegionPresetSelect.value = '';
    await loadCropRecommendations();
    showToast(`Crop recommendations customized for "${query}"`, 'success');
  }

  if (cropApplyCustomLocBtn) {
    cropApplyCustomLocBtn.addEventListener('click', applyCustomCropLocation);
  }
  if (cropCustomLocationInput) {
    cropCustomLocationInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await applyCustomCropLocation();
      }
    });
  }

  if (refreshCropRecsBtn) {
    refreshCropRecsBtn.addEventListener('click', async () => {
      showToast('Recomputing crop suitability matrices...', 'info');
      await loadCropRecommendations();
      showToast('Crop recommendations updated', 'success');
    });
  }

  /* ==========================================================
     6. Smart Irrigation Controller (Interactive Scenario Simulator)
     ========================================================== */
  const irrigationDecisionHero = document.getElementById('irrigationDecisionHero');
  const irrigationDecisionTitle = document.getElementById('irrigationDecisionTitle');
  const irrDecisionEyebrow = document.getElementById('irrDecisionEyebrow');
  const irrigationReasoningText = document.getElementById('irrigationReasoningText');
  const irrStatMoisture = document.getElementById('irrStatMoisture');
  const irrStatRain = document.getElementById('irrStatRain');
  const irrStatEvapo = document.getElementById('irrStatEvapo');
  const irrStatWaterSaved = document.getElementById('irrStatWaterSaved');
  const irrNextWindow = document.getElementById('irrNextWindow');
  const irrRunTime = document.getElementById('irrRunTime');
  const toggleManualIrrigationBtn = document.getElementById('toggleManualIrrigationBtn');

  // Simulator controls inside Section 3
  const irrMoistureSlider = document.getElementById('irrMoistureSlider');
  const irrMoistureVal = document.getElementById('irrMoistureVal');
  const irrRainSlider = document.getElementById('irrRainSlider');
  const irrRainVal = document.getElementById('irrRainVal');
  const irrTempSlider = document.getElementById('irrTempSlider');
  const irrTempVal = document.getElementById('irrTempVal');
  const irrScenarioChips = document.querySelectorAll('.scenario-chip');

  let irrDebounceTimer = null;
  function triggerIrrigationUpdate(immediate = false) {
    if (irrDebounceTimer) clearTimeout(irrDebounceTimer);
    if (immediate) {
      loadIrrigationAdvice();
    } else {
      irrDebounceTimer = setTimeout(loadIrrigationAdvice, 100);
    }
  }

  async function loadIrrigationAdvice() {
    const moisture = irrMoistureSlider ? parseFloat(irrMoistureSlider.value) : (parseFloat(moistureInput?.value) || 68);
    const rainProb = irrRainSlider ? parseFloat(irrRainSlider.value) : (parseFloat(rainProbInput?.value) || 35);
    const temp = irrTempSlider ? parseFloat(irrTempSlider.value) : (parseFloat(tempInput?.value) || 28);

    // Synchronize slider labels
    if (irrMoistureVal) irrMoistureVal.textContent = `${moisture}%`;
    if (irrRainVal) irrRainVal.textContent = `${rainProb}%`;
    if (irrTempVal) irrTempVal.textContent = `${temp}°C`;

    // Also sync Section 1 if sliders exist
    if (moistureInput && moistureInput.value != moisture) {
      moistureInput.value = moisture;
      if (moistureDisplay) moistureDisplay.textContent = `${moisture}%`;
    }
    if (rainProbInput && rainProbInput.value != rainProb) {
      rainProbInput.value = rainProb;
      if (rainProbDisplay) rainProbDisplay.textContent = `${rainProb}%`;
    }
    if (tempInput && tempInput.value != temp) {
      tempInput.value = temp;
      if (tempDisplay) tempDisplay.textContent = `${temp}°C`;
    }

    const data = {
      moisture,
      rainProb,
      temp,
      crop: document.getElementById('cropTypeSelect')?.value || 'Tomato',
      lat: state.currentLocation?.lat,
      lon: state.currentLocation?.lon,
      location: state.currentLocation?.displayName
    };

    try {
      const advice = await window.AgriSmartAPI.getIrrigationAdvice(data);
      state.currentIrrigation = advice;
      renderIrrigationAdvice(advice);
    } catch (err) {
      console.error('Irrigation advice error:', err);
    }
  }

  function renderIrrigationAdvice(advice) {
    if (!irrigationDecisionHero) return;

    const dType = advice.decisionType || (advice.needed ? 'needed' : 'delay');
    irrigationDecisionHero.className = `irrigation-decision-hero ${dType}`;

    if (irrigationDecisionTitle) irrigationDecisionTitle.textContent = advice.decision;

    if (irrDecisionEyebrow) {
      irrDecisionEyebrow.textContent = (
        dType === 'needed' ? 'Active Action Required' :
        dType === 'heatwave' ? 'Heatwave Thermal Alert' :
        dType === 'optimal' ? 'Hydration Buffer Healthy' :
        'Current System Decision'
      );
      irrDecisionEyebrow.style.color = (
        dType === 'needed' ? '#2E7D32' :
        dType === 'heatwave' ? '#C62828' :
        dType === 'optimal' ? '#0288D1' :
        'var(--color-warning)'
      );
    }

    if (irrigationReasoningText) irrigationReasoningText.innerHTML = advice.reasoning;
    if (irrStatMoisture) irrStatMoisture.textContent = `${advice.metrics.soilMoisture}%`;
    if (irrStatRain) irrStatRain.textContent = advice.metrics.rainForecast24h;
    if (irrStatEvapo && advice.metrics.evapotranspiration) irrStatEvapo.textContent = advice.metrics.evapotranspiration;
    if (irrStatWaterSaved && advice.metrics.waterSaved) irrStatWaterSaved.textContent = advice.metrics.waterSaved;
    if (irrNextWindow && advice.schedule) irrNextWindow.textContent = advice.schedule.optimalWindow;
    if (irrRunTime && advice.schedule) irrRunTime.textContent = advice.schedule.runTime || (advice.needed ? '60 Minutes (Active Cycle)' : '0 Minutes (Standby Mode)');
  }

  // Bind scenario preset chips
  if (irrScenarioChips && irrScenarioChips.length > 0) {
    irrScenarioChips.forEach(chip => {
      chip.addEventListener('click', () => {
        irrScenarioChips.forEach(c => {
          c.classList.remove('active');
          c.style.boxShadow = 'none';
        });
        chip.classList.add('active');
        chip.style.boxShadow = '0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-primary-light)';

        const m = parseFloat(chip.dataset.moisture);
        const r = parseFloat(chip.dataset.rain);
        const t = parseFloat(chip.dataset.temp);

        if (irrMoistureSlider) irrMoistureSlider.value = m;
        if (irrRainSlider) irrRainSlider.value = r;
        if (irrTempSlider) irrTempSlider.value = t;

        triggerIrrigationUpdate(true);
      });
    });
  }

  // Bind Section 3 sliders
  [irrMoistureSlider, irrRainSlider, irrTempSlider].forEach(slider => {
    if (!slider) return;
    slider.addEventListener('input', () => {
      // Clear preset chip selection when manually dragging
      irrScenarioChips.forEach(c => {
        c.classList.remove('active');
        c.style.boxShadow = 'none';
      });
      triggerIrrigationUpdate(false);
    });
    slider.addEventListener('change', () => triggerIrrigationUpdate(true));
  });

  // Also bind Section 1 sliders to keep both views in sync
  [moistureInput, rainProbInput, tempInput].forEach(slider => {
    if (!slider) return;
    slider.addEventListener('input', () => {
      if (irrMoistureSlider && moistureInput) irrMoistureSlider.value = moistureInput.value;
      if (irrRainSlider && rainProbInput) irrRainSlider.value = rainProbInput.value;
      if (irrTempSlider && tempInput) irrTempSlider.value = tempInput.value;
      triggerIrrigationUpdate(false);
    });
  });

  if (toggleManualIrrigationBtn) {
    toggleManualIrrigationBtn.addEventListener('click', () => {
      toggleManualIrrigationBtn.disabled = true;
      toggleManualIrrigationBtn.innerHTML = `
        <div class="spinner" style="width: 18px; height: 18px; border-width: 2px; display: inline-block;"></div>
        <span>Pumping 15-Minute Sensor Flush...</span>
      `;

      setTimeout(() => {
        showToast('Valve #1 & #3 line flushed with 450 Liters test water', 'success');
        toggleManualIrrigationBtn.disabled = false;
        toggleManualIrrigationBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" aria-hidden="true">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          <span>Override & Trigger 15-Min Test Flush</span>
        `;
      }, 1500);
    });
  }

  /* ==========================================================
     7. Weather-Based Intelligence Controller
     ========================================================== */
  const weatherHeroTemp = document.getElementById('weatherHeroTemp');
  const weatherHeroDesc = document.getElementById('weatherHeroDesc');
  const weatherHeroHumidity = document.getElementById('weatherHeroHumidity');
  const weatherHeroRain = document.getElementById('weatherHeroRain');
  const weatherHeroWind = document.getElementById('weatherHeroWind');
  const weatherActionBannersContainer = document.getElementById('weatherActionBannersContainer');
  const weatherForecastContainer = document.getElementById('weatherForecastContainer');

  async function loadWeatherAdvice(locationName = null, lat = null, lon = null) {
    const loc = locationName || state.currentLocation?.displayName || 'Surat, Gujarat';
    const latitude = lat !== null && lat !== undefined ? lat : state.currentLocation?.lat;
    const longitude = lon !== null && lon !== undefined ? lon : state.currentLocation?.lon;

    try {
      const data = await window.AgriSmartAPI.getWeatherAdvice(loc, latitude, longitude);
      state.currentWeather = data;
      window.currentWeatherSummary = `${data.current.temp}°C, ${data.current.condition}, ${data.current.rainProb}% rain in ${data.location}`;
      renderWeather(data);
    } catch (err) {
      console.error('Weather advice error:', err);
    }
  }

  function renderWeather(data) {
    if (weatherHeroTemp) weatherHeroTemp.textContent = `${data.current.temp}°C`;
    if (weatherHeroDesc) weatherHeroDesc.textContent = data.current.condition;
    if (weatherHeroHumidity) weatherHeroHumidity.textContent = `${data.current.humidity}%`;
    if (weatherHeroRain) weatherHeroRain.textContent = `${data.current.rainProb}%`;
    if (weatherHeroWind) weatherHeroWind.textContent = `${data.current.windSpeed} km/h`;

    if (weatherHeroLocation) {
      const coordsStr = data.latitude ? ` (${data.latitude.toFixed(2)}°N, ${data.longitude.toFixed(2)}°E)` : '';
      weatherHeroLocation.textContent = `Station: ${data.location}${coordsStr} • Live Telemetry`;
    }
    if (headerLocationText) {
      headerLocationText.textContent = data.location;
    }
    if (headerWeatherVal) {
      headerWeatherVal.textContent = `${data.current.temp}°C • Rain ${data.current.rainProb}%`;
    }

    // Action Banners
    if (weatherActionBannersContainer && data.actionBanners) {
      weatherActionBannersContainer.innerHTML = data.actionBanners.map(banner => `
        <div class="weather-banner ${banner.level}">
          <div class="weather-banner-icon" aria-hidden="true">
            ${getWeatherIconSVG(banner.icon)}
          </div>
          <div class="weather-banner-content">
            <h4>${banner.title}</h4>
            <p>${banner.description}</p>
          </div>
        </div>
      `).join('');
    }

    // 5-Day Forecast
    if (weatherForecastContainer && data.forecast) {
      weatherForecastContainer.innerHTML = data.forecast.map(item => `
        <div class="forecast-card">
          <div class="forecast-day">${item.day}</div>
          <div class="forecast-date">${item.date}</div>
          <div class="forecast-icon" aria-hidden="true">
            ${getWeatherIconSVG(item.icon)}
          </div>
          <div class="forecast-temps">
            <span>${item.tempHigh}°</span>
            <span class="low">${item.tempLow}°</span>
          </div>
          <div style="font-size: 0.8rem; font-weight: 700; color: #0288D1;">💧 ${item.rainProb}% Rain</div>
          <p class="forecast-advisory">${item.advisory}</p>
        </div>
      `).join('');
    }
  }

  function getWeatherIconSVG(iconName) {
    switch (iconName) {
      case 'rain':
      case 'cloud-rain':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="M8 19v2M12 19v2M16 19v2"/></svg>`;
      case 'cloud-sun':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/></svg>`;
      case 'sun':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
      case 'shield-alert':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      default:
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`;
    }
  }

  /* ==========================================================
     8. Sustainability Score Controller (Interactive Simulator)
     ========================================================== */
  const sustainabilityGaugeCircle = document.getElementById('sustainabilityGaugeCircle');
  const sustainabilityScoreNum = document.getElementById('sustainabilityScoreNum');
  const sustainabilityGradeBadge = document.getElementById('sustainabilityGradeBadge');
  const sustainabilityTierBadge = document.getElementById('sustainabilityTierBadge');
  const sustainabilityHeadline = document.getElementById('sustainabilityHeadline');
  const sustainabilityNarrative = document.getElementById('sustainabilityNarrative');
  const sustainabilityPillarsContainer = document.getElementById('sustainabilityPillarsContainer');
  const sustainabilitySuggestionsContainer = document.getElementById('sustainabilitySuggestionsContainer');

  // Simulator controls
  const sustCropSelect = document.getElementById('sustCropSelect');
  const sustAreaInput = document.getElementById('sustAreaInput');
  const sustAreaDisplay = document.getElementById('sustAreaDisplay');
  const sustWaterInput = document.getElementById('sustWaterInput');
  const sustWaterDisplay = document.getElementById('sustWaterDisplay');
  const sustWaterRefHint = document.getElementById('sustWaterRefHint');
  const sustWaterStatusHint = document.getElementById('sustWaterStatusHint');
  const sustFertInput = document.getElementById('sustFertInput');
  const sustFertDisplay = document.getElementById('sustFertDisplay');
  const sustFertStatusHint = document.getElementById('sustFertStatusHint');
  const sustIrrigGroup = document.getElementById('sustIrrigGroup');
  const sustIrrigMethod = document.getElementById('sustIrrigMethod');
  const sustDiseaseToggle = document.getElementById('sustDiseaseToggle');
  const sustPesticideToggle = document.getElementById('sustPesticideToggle');
  const sustResetBtn = document.getElementById('sustResetBtn');

  // Matrix display elements
  const matrixWaterVal = document.getElementById('matrixWaterVal');
  const matrixFertVal = document.getElementById('matrixFertVal');
  const matrixIrrigVal = document.getElementById('matrixIrrigVal');
  const matrixHealthVal = document.getElementById('matrixHealthVal');

  const FAO_WATER_MAP = {
    'Tomato': 28000,
    'Potato': 25000,
    'Wheat': 25000,
    'Rice': 60000,
    'Maize': 30000,
    'Cotton': 35000,
  };

  let sustDebounceTimer = null;
  function triggerSustainabilityUpdate(immediate = false) {
    if (sustDebounceTimer) clearTimeout(sustDebounceTimer);
    if (immediate) {
      loadSustainability();
    } else {
      sustDebounceTimer = setTimeout(loadSustainability, 120);
    }
  }

  async function loadSustainability() {
    const crop = sustCropSelect?.value || 'Tomato';
    const area = parseFloat(sustAreaInput?.value || 2.0);
    const water = parseFloat(sustWaterInput?.value || 35000);
    const fert = parseFloat(sustFertInput?.value || 45);
    const method = sustIrrigMethod?.value || 'drip';
    const disease = Boolean(sustDiseaseToggle?.checked);
    const pesticide = Boolean(sustPesticideToggle?.checked);

    // Update real-time label values
    if (sustAreaDisplay) sustAreaDisplay.textContent = `${area.toFixed(1)} Hectares`;
    if (sustWaterDisplay) sustWaterDisplay.textContent = `${water.toLocaleString()} Litres`;
    if (sustFertDisplay) sustFertDisplay.textContent = `${fert} kg/ha`;

    // Dynamic hints
    const refPerHa = FAO_WATER_MAP[crop] || 28000;
    const totalRef = refPerHa * area;
    if (sustWaterRefHint) {
      sustWaterRefHint.innerHTML = `FAO Reference Target: <strong>${totalRef.toLocaleString()} L</strong>`;
    }
    if (sustWaterStatusHint) {
      if (water <= totalRef) {
        sustWaterStatusHint.textContent = 'Within Conservation Budget';
        sustWaterStatusHint.style.color = '#2E7D32';
      } else {
        const excessPct = Math.round(((water - totalRef) / totalRef) * 100);
        sustWaterStatusHint.textContent = `+${excessPct}% Above Target`;
        sustWaterStatusHint.style.color = '#E65100';
      }
    }

    if (sustFertStatusHint) {
      if (fert <= 40) {
        sustFertStatusHint.textContent = 'Optimal Sustainable Dosage';
        sustFertStatusHint.style.color = '#2E7D32';
      } else {
        const excessKg = fert - 40;
        sustFertStatusHint.textContent = `+${excessKg} kg/ha Excess (-${excessKg * 2} pts)`;
        sustFertStatusHint.style.color = '#E65100';
      }
    }

    const payload = {
      crop,
      area_hectares: area,
      water_used_liters: water,
      fertilizer_kg_per_hectare: fert,
      irrigation_method: method,
      disease_detected: disease,
      pesticide_used: pesticide,
    };

    try {
      const data = await window.AgriSmartAPI.getSustainabilityScore(payload);
      state.currentSustainability = data;
      renderSustainability(data);
    } catch (err) {
      console.error('Sustainability score error:', err);
    }
  }

  function renderSustainability(data) {
    if (sustainabilityScoreNum) sustainabilityScoreNum.textContent = Math.round(data.overallScore);

    // Animate circular gauge & dynamic stroke color
    if (sustainabilityGaugeCircle) {
      const circumference = 314.159;
      const offset = circumference * (1 - (data.overallScore / 100));
      sustainabilityGaugeCircle.style.strokeDashoffset = offset;

      if (data.overallScore >= 85) {
        sustainabilityGaugeCircle.style.stroke = 'var(--color-primary)';
      } else if (data.overallScore >= 65) {
        sustainabilityGaugeCircle.style.stroke = '#F59E0B';
      } else {
        sustainabilityGaugeCircle.style.stroke = '#EF4444';
      }
    }

    // Grade badge
    if (sustainabilityGradeBadge && data.grade) {
      sustainabilityGradeBadge.textContent = `Grade ${data.grade}`;
      sustainabilityGradeBadge.style.color = (
        data.grade === 'A' ? '#2E7D32' :
        data.grade === 'B' ? '#15803D' :
        data.grade === 'C' ? '#D97706' :
        '#DC2626'
      );
    }

    // Tier badge & narrative
    if (sustainabilityTierBadge && data.tier) {
      sustainabilityTierBadge.textContent = data.tier;
    }
    if (sustainabilityHeadline) {
      sustainabilityHeadline.textContent = (
        data.overallScore >= 85 ? 'Top 14% Regional Eco-Efficiency' :
        data.overallScore >= 65 ? 'Moderate Resource Efficiency' :
        'High Resource Footprint Alert'
      );
    }
    if (sustainabilityNarrative) {
      sustainabilityNarrative.textContent = (
        data.overallScore >= 85
          ? 'Sensor-driven precision drip scheduling and controlled fertilizer dosage keep your farm in the sustainable green zone.'
          : data.overallScore >= 65
          ? 'Resource inputs are partially exceeding optimal regenerative limits. Adjust water volumes or switch irrigation methods to improve score.'
          : 'High resource consumption or disease stress detected. Follow prioritized intervention steps below to mitigate loss.'
      );
    }

    // Matrix display
    if (data.breakdown && data.breakdown.length >= 4) {
      if (matrixWaterVal) matrixWaterVal.textContent = `${Math.round(data.breakdown[0].score)}%`;
      if (matrixFertVal) matrixFertVal.textContent = `${Math.round(data.breakdown[1].score)}%`;
      if (matrixIrrigVal) matrixIrrigVal.textContent = `${Math.round(data.breakdown[2].score)}%`;
      if (matrixHealthVal) matrixHealthVal.textContent = `${Math.round(data.breakdown[3].score)}%`;
    }

    // Render pillars
    if (sustainabilityPillarsContainer && data.breakdown) {
      sustainabilityPillarsContainer.innerHTML = data.breakdown.map(pillar => `
        <div class="sustainability-pillar-card">
          <div class="pillar-header">
            <span class="pillar-title">${pillar.pillar}</span>
            <span class="pillar-score" style="color: ${pillar.color};">${Math.round(pillar.score)}/100</span>
          </div>
          <div class="confidence-track" style="height: 8px;">
            <div class="confidence-fill" style="width: ${pillar.score}%; background: ${pillar.color};"></div>
          </div>
          <p style="font-size: 0.85rem; color: var(--color-text-muted);">${pillar.summary}</p>
          <div style="font-size: 0.78rem; font-weight: 700; color: var(--color-primary);">${pillar.metric}</div>
        </div>
      `).join('');
    }

    // Render suggestions
    if (sustainabilitySuggestionsContainer && data.suggestions) {
      sustainabilitySuggestionsContainer.innerHTML = data.suggestions.map(sug => `
        <div class="suggestion-card">
          <div class="suggestion-badge">${sug.impact}</div>
          <div style="flex: 1;">
            <h4 style="font-size: 0.98rem; margin-bottom: 0.25rem;">${sug.title}</h4>
            <p style="font-size: 0.88rem;">${sug.description}</p>
          </div>
        </div>
      `).join('');
    }
  }

  // Segmented control click handler
  if (sustIrrigGroup) {
    const btns = sustIrrigGroup.querySelectorAll('.segmented-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');
        if (sustIrrigMethod) sustIrrigMethod.value = btn.dataset.method;
        triggerSustainabilityUpdate(true);
      });
    });
  }

  // Sliders and select event listeners
  [sustCropSelect, sustAreaInput, sustWaterInput, sustFertInput, sustDiseaseToggle, sustPesticideToggle].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => triggerSustainabilityUpdate(false));
    el.addEventListener('change', () => triggerSustainabilityUpdate(true));
  });

  // Reset button handler
  if (sustResetBtn) {
    sustResetBtn.addEventListener('click', () => {
      if (sustCropSelect) sustCropSelect.value = 'Tomato';
      if (sustAreaInput) sustAreaInput.value = '2.0';
      if (sustWaterInput) sustWaterInput.value = '35000';
      if (sustFertInput) sustFertInput.value = '45';
      if (sustIrrigMethod) sustIrrigMethod.value = 'drip';
      if (sustDiseaseToggle) sustDiseaseToggle.checked = false;
      if (sustPesticideToggle) sustPesticideToggle.checked = false;

      const btns = sustIrrigGroup?.querySelectorAll('.segmented-btn');
      btns?.forEach(b => {
        const isDrip = b.dataset.method === 'drip';
        b.classList.toggle('active', isDrip);
        b.setAttribute('aria-checked', isDrip ? 'true' : 'false');
      });

      showToast('Restored baseline telemetry (Score: ~94 / Grade A)', 'info');
      triggerSustainabilityUpdate(true);
    });
  }

  /* ==========================================================
     9. Farmer Assistant Chat Controller
     ========================================================== */
  const chatInputForm = document.getElementById('chatInputForm');
  const chatInputField = document.getElementById('chatInputField');
  const chatMessagesStream = document.getElementById('chatMessagesStream');
  const assistantLanguageSelect = document.getElementById('assistantLanguageSelect');

  if (assistantLanguageSelect) {
    assistantLanguageSelect.addEventListener('change', (e) => {
      state.currentLanguage = e.target.value;
      const langNames = { en: 'English', hi: 'Hindi', mr: 'Marathi', te: 'Telugu', es: 'Spanish' };
      showToast(`Assistant switched to ${langNames[e.target.value] || 'English'}`, 'info');
    });
  }

  if (chatInputForm) {
    chatInputForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const question = chatInputField.value.trim();
      if (!question) return;

      // Append user bubble
      appendChatMessage(question, 'user');
      chatInputField.value = '';

      // Show typing indicator
      const typingId = showTypingIndicator();

      try {
        const assistantContext = {
          location: state.currentLocation?.displayName || 'Surat, Gujarat',
          weatherSummary: state.currentWeather ? `${state.currentWeather.current.temp}°C, ${state.currentWeather.current.condition}, ${state.currentWeather.current.rainProb}% rain` : undefined,
          crop: document.getElementById('cropTypeSelect')?.value || 'Tomato',
          diseaseDetected: state.lastAnalysisResult?.disease || undefined,
          irrigationAdvice: state.currentIrrigation?.decision || undefined
        };
        const response = await window.AgriSmartAPI.askAssistant(question, state.currentLanguage, assistantContext);
        removeTypingIndicator(typingId);
        appendChatMessage(response.text, 'bot', response.timestamp);
      } catch (err) {
        removeTypingIndicator(typingId);
        appendChatMessage('I encountered an issue connecting to the agricultural knowledge base. Please try again.', 'bot');
      }
    });
  }

  // Suggestion prompt chips
  document.querySelectorAll('.chat-prompt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      if (chatInputField) {
        chatInputField.value = prompt;
        chatInputForm.dispatchEvent(new Event('submit'));
      }
    });
  });

  function appendChatMessage(text, sender, time = 'Just now') {
    if (!chatMessagesStream) return;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${sender}`;

    // Format newlines and markdown-like bold
    const formattedText = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

    bubble.innerHTML = `
      <div>${formattedText}</div>
      <div class="chat-time">${time}</div>
    `;

    chatMessagesStream.appendChild(bubble);
    chatMessagesStream.scrollTop = chatMessagesStream.scrollHeight;
  }

  function showTypingIndicator() {
    const id = 'typing-' + Date.now();
    const bubble = document.createElement('div');
    bubble.id = id;
    bubble.className = 'chat-bubble bot';
    bubble.innerHTML = `
      <div class="typing-bubble">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    `;
    chatMessagesStream.appendChild(bubble);
    chatMessagesStream.scrollTop = chatMessagesStream.scrollHeight;
    return id;
  }

  function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  /* ==========================================================
     10. Agentic Advisor Feed Controller
     ========================================================== */
  const agenticTimelineContainer = document.getElementById('agenticTimelineContainer');
  const triggerAgentCycleBtn = document.getElementById('triggerAgentCycleBtn');
  const agenticFilterChips = document.getElementById('agenticFilterChips');
  const feedCountLabel = document.getElementById('feedCountLabel');
  const agenticUnreadBadge = document.getElementById('agenticUnreadBadge');

  async function loadAgenticFeed() {
    try {
      const events = await window.AgriSmartAPI.getAgenticFeed();
      state.agenticEvents = events;
      renderAgenticTimeline();
    } catch (err) {
      console.error('Agentic feed error:', err);
    }
  }

  function renderAgenticTimeline() {
    if (!agenticTimelineContainer) return;

    const filtered = state.agenticEvents.filter(item => {
      if (state.activeAgentFilter === 'all') return true;
      return item.type === state.activeAgentFilter;
    });

    if (feedCountLabel) {
      feedCountLabel.textContent = `Showing ${filtered.length} recorded events`;
    }

    if (agenticUnreadBadge) {
      agenticUnreadBadge.textContent = state.agenticEvents.length;
    }

    if (filtered.length === 0) {
      agenticTimelineContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 2rem;">
          <p>No agentic events matching the "${state.activeAgentFilter}" filter.</p>
        </div>
      `;
      return;
    }

    agenticTimelineContainer.innerHTML = filtered.map(evt => `
      <article class="timeline-item ${evt.time === 'Just now' ? 'highlight-new' : ''}" aria-label="Event: ${evt.title}">
        <div class="timeline-top-row">
          <span class="timeline-badge ${evt.badgeClass}">${evt.badge}</span>
          <span class="timeline-time">${evt.time}</span>
        </div>
        <h4 class="timeline-title">${evt.title}</h4>
        <div class="timeline-detail-grid">
          <div class="timeline-detail-row">
            <strong>Observation Trigger:</strong> ${evt.trigger}
          </div>
          <div class="timeline-detail-row">
            <strong>Autonomous Reasoning:</strong> ${evt.reasoning}
          </div>
          <div class="timeline-detail-row">
            <strong>Action Dispatched:</strong> ${evt.actionTaken}
          </div>
        </div>
      </article>
    `).join('');
  }

  // Filter buttons click
  if (agenticFilterChips) {
    agenticFilterChips.addEventListener('click', (e) => {
      const btn = e.target.closest('.feed-filter-btn');
      if (!btn) return;

      document.querySelectorAll('.feed-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      state.activeAgentFilter = btn.getAttribute('data-filter') || 'all';
      renderAgenticTimeline();
    });
  }

  // Trigger on-demand agent cycle
  if (triggerAgentCycleBtn) {
    triggerAgentCycleBtn.addEventListener('click', async () => {
      triggerAgentCycleBtn.disabled = true;
      triggerAgentCycleBtn.innerHTML = `
        <div class="spinner" style="width: 16px; height: 16px; border-width: 2px; display: inline-block;"></div>
        <span>Evaluating Telemetry Telemetry...</span>
      `;

      try {
        const newEvent = await window.AgriSmartAPI.triggerAgentCheck();
        state.agenticEvents.unshift(newEvent);
        renderAgenticTimeline();
        showToast(`Autonomous Agent: ${newEvent.title}`, 'success');
      } catch (err) {
        showToast('Agent evaluation failed: ' + err.message, 'warning');
      } finally {
        triggerAgentCycleBtn.disabled = false;
        triggerAgentCycleBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="18" height="18" aria-hidden="true">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          <span>Trigger Agent Check Now</span>
        `;
      }
    });
  }

  /* ==========================================================
     10B. Interactive Agent Cognitive Simulator Controller
     ========================================================== */
  const simMoistureSlider = document.getElementById('simMoistureSlider');
  const simMoistureVal = document.getElementById('simMoistureVal');
  const simRainSlider = document.getElementById('simRainSlider');
  const simRainVal = document.getElementById('simRainVal');
  const simTempSlider = document.getElementById('simTempSlider');
  const simTempVal = document.getElementById('simTempVal');
  const simHumiditySlider = document.getElementById('simHumiditySlider');
  const simHumidityVal = document.getElementById('simHumidityVal');
  const simSolarSlider = document.getElementById('simSolarSlider');
  const simSolarVal = document.getElementById('simSolarVal');

  const simPipelineTriggerTitle = document.getElementById('simPipelineTriggerTitle');
  const simPipelineTriggerDesc = document.getElementById('simPipelineTriggerDesc');
  const simPipelineSensingMeta = document.getElementById('simPipelineSensingMeta');

  const simPipelineReasoningTitle = document.getElementById('simPipelineReasoningTitle');
  const simPipelineReasoningDesc = document.getElementById('simPipelineReasoningDesc');
  const simPipelineModelMeta = document.getElementById('simPipelineModelMeta');

  const simPipelineActuatorBox = document.getElementById('simPipelineActuatorBox');
  const simActuatorBadge = document.getElementById('simActuatorBadge');
  const simActuatorStatusText = document.getElementById('simActuatorStatusText');
  const simActuatorTargetTitle = document.getElementById('simActuatorTargetTitle');
  const simActuatorActionDesc = document.getElementById('simActuatorActionDesc');
  const simActuatorHardwareMeta = document.getElementById('simActuatorHardwareMeta');

  const agentSimScenarioChips = document.getElementById('agentSimScenarioChips');
  const simResetBtn = document.getElementById('simResetBtn');
  const simExecuteCycleBtn = document.getElementById('simExecuteCycleBtn');

  let currentSimEvaluation = null;

  const agentScenarioPresets = {
    rain: { moisture: 65, rain: 70, temp: 26, humidity: 80, solar: 250 },
    blight: { moisture: 55, rain: 25, temp: 28, humidity: 88, solar: 400 },
    solar: { moisture: 35, rain: 5, temp: 31, humidity: 45, solar: 890 },
    heatwave: { moisture: 22, rain: 0, temp: 43, humidity: 25, solar: 950 }
  };

  function updateAgenticSimulator() {
    if (!simMoistureSlider) return;

    const moisture = parseInt(simMoistureSlider.value, 10);
    const rain = parseInt(simRainSlider.value, 10);
    const temp = parseInt(simTempSlider.value, 10);
    const humidity = parseInt(simHumiditySlider.value, 10);
    const solar = parseInt(simSolarSlider.value, 10);

    if (simMoistureVal) simMoistureVal.textContent = `${moisture}%`;
    if (simRainVal) simRainVal.textContent = `${rain}%`;
    if (simTempVal) simTempVal.textContent = `${temp}°C`;
    if (simHumidityVal) simHumidityVal.textContent = `${humidity}%`;
    if (simSolarVal) simSolarVal.textContent = `${solar} W/m²`;

    let evalResult = {};

    // 1. Rain Surge / Smart Valve Hold
    if (rain >= 50 && moisture >= 40) {
      evalResult = {
        theme: 'rain',
        triggerTitle: `Precipitation Surge Detected (${rain}% Chance)`,
        triggerDesc: `Rain radar surge to ${rain}% with projected rainfall within 12h. Soil moisture currently ${moisture}%.`,
        triggerMeta: `Source: Open-Meteo Radar API + Field Tensiometer #2`,
        reasoningTitle: `Root Hypoxia & Nitrogen Leaching Prevention`,
        reasoningDesc: `Soil moisture (${moisture}%) comfortably exceeds the 35% wilting threshold. Imminent rainfall will recharge the root zone naturally. Irrigating now would oversaturate root pockets, induce anaerobic stress, and leach soluble Nitrogen fertilizer.`,
        reasoningMeta: `Engine: FAO-56 Water Balance + Leaching Risk Matrix`,
        actuatorStatus: `PAUSED (RAIN HOLD)`,
        actuatorTarget: `Smart Drip Valve #2 (Plot A)`,
        actuatorActionDesc: `Auto-paused drip manifold valve until tomorrow 8:00 AM. Estimated water conserved: ~${Math.round(14000 * (rain / 70)).toLocaleString()} Liters.`,
        actuatorMeta: `Actuator: Solenoid Relay Valve #2 (Drip Line)`,
        boxBg: '#FFF8E1',
        boxBorder: '#FFE082',
        boxBorderLeft: '#E65100',
        badgeBg: 'rgba(230,81,0,0.15)',
        badgeColor: '#E65100',
        dotColor: '#E65100',
        feedItem: {
          type: 'autonomous',
          badge: 'Autonomous Action',
          badgeClass: 'badge-autonomous',
          title: `Postponed Scheduled Drip Valve #2 — Rain Forecast (${rain}%)`,
          trigger: `Rain probability at ${rain}% + Soil moisture at ${moisture}%.`,
          reasoning: `Natural precipitation will recharge root zone without depleting farm groundwater or leaching nitrogen.`,
          actionTaken: `Dispatched electrical hold command to Drip Valve #2 until next moisture check cycle.`
        }
      };
    }
    // 2. Fungal Blight Risk / Pathogen Alert
    else if (humidity >= 75 && temp >= 22 && temp <= 32) {
      evalResult = {
        theme: 'blight',
        triggerTitle: `Fungal Microclimate Incubation Threshold Crossed`,
        triggerDesc: `Relative humidity sustained at ${humidity}% with ambient temperature of ${temp}°C. Leaf wetness index elevated.`,
        triggerMeta: `Source: Microclimate Canopy Sensor Node #3`,
        reasoningTitle: `Alternaria solani Germination Profile Match`,
        reasoningDesc: `Sustained high humidity (${humidity}%) at ${temp}°C accelerates spore germination. Prophylactic intervention now prevents up to 85% of foliar damage before visible lesions develop.`,
        reasoningMeta: `Engine: Plant Pathology Spore Germination Predictor`,
        actuatorStatus: `SCHEDULED (PROPHYLACTIC BIO-SPRAY)`,
        actuatorTarget: `Autonomous Drone Sprayer / Bio-Mist Kit`,
        actuatorActionDesc: `Scheduled bio-fungicide (Trichoderma viride @ 2.5g/L) dispersal for sunrise (6:30 AM).`,
        actuatorMeta: `Actuator: Automated Farm Notification + Drone Flight Task`,
        boxBg: '#FFEBEE',
        boxBorder: '#FFCDD2',
        boxBorderLeft: '#C62828',
        badgeBg: 'rgba(198,40,40,0.15)',
        badgeColor: '#C62828',
        dotColor: '#C62828',
        feedItem: {
          type: 'alert',
          badge: 'Pathogen Alert',
          badgeClass: 'badge-alert',
          title: `Fungal Sporulation Risk Flagged (RH ${humidity}%, ${temp}°C)`,
          trigger: `Ambient humidity sustained above ${humidity}% at ${temp}°C.`,
          reasoning: `Microclimate matches Alternaria solani incubation criteria. Preventative bio-spray indicated.`,
          actionTaken: `Dispatched prophylactic bio-fungicide recommendation and alerted Farmer Dashboard.`
        }
      };
    }
    // 3. Peak Solar Fertigation / Free Energy Optimization
    else if (solar >= 700 && rain < 40 && moisture <= 55) {
      evalResult = {
        theme: 'solar',
        triggerTitle: `Peak Solar Irradiance Window (${solar} W/m²)`,
        triggerDesc: `Photovoltaic rooftop array generating surplus clean energy (4.4 kW). Farm electricity grid draw tariff is 0.00 INR.`,
        triggerMeta: `Source: 5kW Solar Inverter Smart Telemetry Gateway`,
        reasoningTitle: `Zero-Cost Solar-Synchronized Fertigation`,
        reasoningDesc: `Soil moisture (${moisture}%) requires replenishment. Running water pumps and Venturi nutrient injectors during peak solar eliminates utility grid costs while maintaining peak drip pressure.`,
        reasoningMeta: `Engine: Agri-Photovoltaic Smart Energy Router`,
        actuatorStatus: `RUNNING (SOLAR SYNC)`,
        actuatorTarget: `Solar VFD Water Pump & Venturi Injector #1`,
        actuatorActionDesc: `Engaged drip pressurization and soluble Potassium injection across 2.5 acres at 0 INR electricity cost.`,
        actuatorMeta: `Actuator: 3-Phase Solar VFD Inverter Controller`,
        boxBg: '#E8F5E9',
        boxBorder: '#A5D6A7',
        boxBorderLeft: '#2E7D32',
        badgeBg: 'rgba(46,125,50,0.15)',
        badgeColor: '#2E7D32',
        dotColor: '#2E7D32',
        feedItem: {
          type: 'autonomous',
          badge: 'Solar Optimization',
          badgeClass: 'badge-autonomous',
          title: `Solar-Synchronized Fertigation Cycle Started (${solar} W/m²)`,
          trigger: `Solar irradiance peaked at ${solar} W/m² (zero grid power tariff).`,
          reasoning: `Running irrigation pump now delivers required water & Potassium at zero utility cost.`,
          actionTaken: `Engaged Solar VFD pump #1 and injected 2.5 kg Potassium Sulfate across Plot A.`
        }
      };
    }
    // 4. Extreme Heatwave / Canopy Mist Cooling
    else if (temp >= 38 && moisture <= 40) {
      evalResult = {
        theme: 'heatwave',
        triggerTitle: `Extreme Heatwave & Stomatal Stress (${temp}°C)`,
        triggerDesc: `Ambient temperature reached ${temp}°C with low humidity (${humidity}%). Vapor Pressure Deficit (VPD) in critical stress zone.`,
        triggerMeta: `Source: Hyper-local Weather Station + Canopy Pyrometer`,
        reasoningTitle: `Transpirational Shock & Flower Drop Prevention`,
        reasoningDesc: `High heat (${temp}°C) induces flower abortion and stomatal closure, halting photosynthesis. An ultra-fine 15-minute overhead mist pulse cools the leaf canopy by ~4.5°C without waterlogging root zones.`,
        reasoningMeta: `Engine: Thermal Vapor Pressure Deficit (VPD) Model`,
        actuatorStatus: `ACTIVE (15-MIN COOLING PULSE)`,
        actuatorTarget: `Overhead Micro-Sprinkler Zone B`,
        actuatorActionDesc: `Activated 15-minute pulsed cooling mist. Canopy temperature drop target: -4.5°C.`,
        actuatorMeta: `Actuator: High-Pressure Mist Nozzle Solenoid #4`,
        boxBg: '#FBE9E7',
        boxBorder: '#FFCCBC',
        boxBorderLeft: '#D84315',
        badgeBg: 'rgba(216,67,21,0.15)',
        badgeColor: '#D84315',
        dotColor: '#D84315',
        feedItem: {
          type: 'alert',
          badge: 'Heatwave Action',
          badgeClass: 'badge-alert',
          title: `Autonomous Canopy Cooling Pulse Dispatched (${temp}°C)`,
          trigger: `Extreme heat (${temp}°C) and elevated vapor pressure deficit detected.`,
          reasoning: `Micro-pulse cooling prevents blossom end drop and maintains cellular respiration.`,
          actionTaken: `Triggered 15-minute overhead canopy cooling pulse via Solenoid #4.`
        }
      };
    }
    // 5. Dry & Depleted
    else if (moisture <= 35 && rain < 35) {
      evalResult = {
        theme: 'dry',
        triggerTitle: `Soil Moisture Depleted (${moisture}%)`,
        triggerDesc: `Soil moisture dropped below the 35% critical management threshold. No precipitation in forecast.`,
        triggerMeta: `Source: Dual-Depth FDR Soil Probe #1`,
        reasoningTitle: `FAO-56 Readily Available Water (RAW) Depletion`,
        reasoningDesc: `Root zone moisture is depleted. Prolonged deficit will reduce fruit set and induce drought dormancy. Deep root irrigation required immediately.`,
        reasoningMeta: `Engine: FAO-56 Crop Evapotranspiration Calculator`,
        actuatorStatus: `IRRIGATING (DEEP SOAK)`,
        actuatorTarget: `Main Drip Line Solenoid Valve #1`,
        actuatorActionDesc: `Dispatched open command for 45-minute scheduled soak (Volume: 12,500 L).`,
        actuatorMeta: `Actuator: Main Field Pump Relay #1`,
        boxBg: '#E1F5FE',
        boxBorder: '#B3E5FC',
        boxBorderLeft: '#0288D1',
        badgeBg: 'rgba(2,136,209,0.15)',
        badgeColor: '#0288D1',
        dotColor: '#0288D1',
        feedItem: {
          type: 'autonomous',
          badge: 'Irrigation Active',
          badgeClass: 'badge-autonomous',
          title: `Root Zone Irrigation Dispatched (${moisture}% Moisture)`,
          trigger: `Soil moisture dropped below critical management boundary (35%).`,
          reasoning: `Crop is experiencing water deficit. 45-minute deep soak restores root field capacity.`,
          actionTaken: `Opened Solenoid Valve #1 for 45-minute cycle.`
        }
      };
    }
    // 6. Optimal Baseline
    else {
      evalResult = {
        theme: 'optimal',
        triggerTitle: `Steady-State Microclimate Telemetry`,
        triggerDesc: `Soil moisture at ${moisture}%, temp ${temp}°C, rain chance ${rain}%, solar ${solar} W/m².`,
        triggerMeta: `Source: Unified Multi-Sensor Array`,
        reasoningTitle: `Agronomic Parameters Within Nominal Safety Range`,
        reasoningDesc: `Soil moisture is within the optimal 50%–70% field capacity range. Microclimate conditions do not favor pathogen propagation. Systems maintained in passive standby.`,
        reasoningMeta: `Engine: Multi-Parameter Agro-Safety Guardrail`,
        actuatorStatus: `STANDBY (MONITORING)`,
        actuatorTarget: `All Field Actuators & Solenoids`,
        actuatorActionDesc: `All systems nominal. Background sensor scan interval maintained at 30 minutes.`,
        actuatorMeta: `Actuator: Automated Heartbeat Daemon`,
        boxBg: '#F8FCF6',
        boxBorder: '#C8E6C9',
        boxBorderLeft: '#2E7D32',
        badgeBg: 'rgba(46,125,50,0.12)',
        badgeColor: '#2E7D32',
        dotColor: '#2E7D32',
        feedItem: {
          type: 'routine',
          badge: 'Telemetry Check',
          badgeClass: 'badge-routine',
          title: `Autonomous Agro-Safety Scan Completed`,
          trigger: `Periodic telemetry check at ${moisture}% moisture and ${temp}°C.`,
          reasoning: `All agronomic and environmental parameters within safe boundary limits.`,
          actionTaken: `Maintained standby status; next scheduled diagnostic in 30 minutes.`
        }
      };
    }

    currentSimEvaluation = evalResult;

    // Update DOM
    if (simPipelineTriggerTitle) simPipelineTriggerTitle.textContent = evalResult.triggerTitle;
    if (simPipelineTriggerDesc) simPipelineTriggerDesc.textContent = evalResult.triggerDesc;
    if (simPipelineSensingMeta) simPipelineSensingMeta.textContent = evalResult.triggerMeta;

    if (simPipelineReasoningTitle) simPipelineReasoningTitle.textContent = evalResult.reasoningTitle;
    if (simPipelineReasoningDesc) simPipelineReasoningDesc.textContent = evalResult.reasoningDesc;
    if (simPipelineModelMeta) simPipelineModelMeta.textContent = evalResult.reasoningMeta;

    if (simPipelineActuatorBox) {
      simPipelineActuatorBox.style.background = evalResult.boxBg;
      simPipelineActuatorBox.style.borderColor = evalResult.boxBorder;
      simPipelineActuatorBox.style.borderLeftColor = evalResult.boxBorderLeft;
    }
    if (simActuatorBadge) {
      simActuatorBadge.style.background = evalResult.badgeBg;
      simActuatorBadge.style.color = evalResult.badgeColor;
      const dot = simActuatorBadge.querySelector('.actuator-pulse-dot');
      if (dot) dot.style.background = evalResult.dotColor;
    }
    if (simActuatorStatusText) simActuatorStatusText.textContent = evalResult.actuatorStatus;
    if (simActuatorTargetTitle) simActuatorTargetTitle.textContent = evalResult.actuatorTarget;
    if (simActuatorActionDesc) simActuatorActionDesc.textContent = evalResult.actuatorActionDesc;
    if (simActuatorHardwareMeta) {
      simActuatorHardwareMeta.textContent = evalResult.actuatorMeta;
      simActuatorHardwareMeta.style.color = evalResult.badgeColor;
    }
  }

  function applyAgenticScenario(scenarioKey) {
    const config = agentScenarioPresets[scenarioKey];
    if (!config) return;

    if (simMoistureSlider) simMoistureSlider.value = config.moisture;
    if (simRainSlider) simRainSlider.value = config.rain;
    if (simTempSlider) simTempSlider.value = config.temp;
    if (simHumiditySlider) simHumiditySlider.value = config.humidity;
    if (simSolarSlider) simSolarSlider.value = config.solar;

    document.querySelectorAll('.agent-scenario-chip').forEach(chip => {
      if (chip.getAttribute('data-scenario') === scenarioKey) {
        chip.classList.add('active');
        chip.style.borderColor = chip.style.color;
      } else {
        chip.classList.remove('active');
        chip.style.borderColor = 'var(--color-border)';
      }
    });

    updateAgenticSimulator();
  }

  // Bind slider events
  [simMoistureSlider, simRainSlider, simTempSlider, simHumiditySlider, simSolarSlider].forEach(slider => {
    if (slider) {
      slider.addEventListener('input', () => {
        document.querySelectorAll('.agent-scenario-chip').forEach(c => c.classList.remove('active'));
        updateAgenticSimulator();
      });
    }
  });

  // Bind preset chip clicks
  if (agentSimScenarioChips) {
    agentSimScenarioChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.agent-scenario-chip');
      if (!chip) return;
      const scenario = chip.getAttribute('data-scenario');
      if (scenario) applyAgenticScenario(scenario);
    });
  }

  // Bind Execute & Log to Feed
  if (simExecuteCycleBtn) {
    simExecuteCycleBtn.addEventListener('click', () => {
      if (!currentSimEvaluation || !currentSimEvaluation.feedItem) return;

      const item = {
        ...currentSimEvaluation.feedItem,
        time: 'Just now',
        id: 'sim-' + Date.now()
      };

      state.agenticEvents.unshift(item);
      renderAgenticTimeline();
      showToast(`Autonomous Agent: ${item.title}`, 'success');

      // Scroll smoothly to timeline
      if (agenticTimelineContainer) {
        agenticTimelineContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  // Bind Reset button
  if (simResetBtn) {
    simResetBtn.addEventListener('click', () => {
      applyAgenticScenario('rain');
      showToast('Agent simulator reset to baseline scenario.', 'info');
    });
  }

  // Initialize simulator state on load
  updateAgenticSimulator();

  /* ==========================================================
     11. Toast Notification Utility
     ========================================================== */
  const toastContainer = document.getElementById('toastContainer');

  function showToast(message, type = 'info', duration = 3200) {
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18" aria-hidden="true">
        ${type === 'success' 
          ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' 
          : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
      </svg>
      <span>${message}</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 200ms ease';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  /* ==========================================================
     12. Section Activation Lifecycle
     ========================================================== */
  function handleSectionActivation(sectionId) {
    switch (sectionId) {
      case 'section-crop':
        if (!state.currentCropRecs) loadCropRecommendations();
        break;
      case 'section-irrigation':
        if (!state.currentIrrigation) loadIrrigationAdvice();
        break;
      case 'section-weather':
        if (!state.currentWeather) loadWeatherAdvice();
        break;
      case 'section-sustainability':
        loadSustainability();
        break;
      case 'section-agentic':
        if (state.agenticEvents.length === 0) loadAgenticFeed();
        updateAgenticSimulator();
        break;
      default:
        break;
    }
  }

  // Initialize Location tracking and primary views on boot
  autoDetectIpLocation();
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.AgriSmartAPI.reverseGeocodeLocation(pos.coords.latitude, pos.coords.longitude).then(rev => {
          applyLocationUpdate({
            name: rev.city || 'My Farm',
            displayName: rev.display_name || `${pos.coords.latitude.toFixed(3)}°N, ${pos.coords.longitude.toFixed(3)}°E`,
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            source: 'High-Precision GPS'
          });
        });
      },
      (err) => console.log('Background GPS passive check:', err.message),
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
    );
  }

  loadCropRecommendations();
  loadIrrigationAdvice();
  loadSustainability();
  loadAgenticFeed();

  // Set default sample leaf on first boot for immediate delight
  const defaultSampleBtn = document.querySelector('.sample-chip[data-preset="tomato_blight"]');
  if (defaultSampleBtn) {
    defaultSampleBtn.click();
  }

  // Deep-linking via URL hash (safely executed after all modules are initialized)
  if (window.location.hash) {
    const hashId = window.location.hash.replace('#', '');
    if (document.getElementById(hashId)) {
      switchSection(hashId);
    }
  }

});
