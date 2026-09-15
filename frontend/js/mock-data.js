/**
 * AgriSmart AI - Mock Data Engine
 * Realistic agricultural data and simulated network responses.
 * Designed to be swapped seamlessly with real backend ML endpoints.
 */

// Simulated network delay helper
const simulateDelay = (ms = 600) => new Promise(resolve => setTimeout(resolve, ms));

// Sample leaf test presets for instant one-click testing
const SAMPLE_LEAF_PRESETS = {
  tomato_blight: {
    name: 'Tomato - Leaf Specimen',
    crop: 'Tomato',
    stage: 'Fruiting',
    soil: 'Loamy',
    ph: 6.4,
    moisture: 58,
    temp: 26,
    rainProb: 30,
    location: 'Nashik Valley, MH',
    imageLabel: 'Tomato Leaf Specimen (PlantVillage)',
    svgType: 'healthy',
    isDiseased: false
  },
  corn_healthy: {
    name: 'Corn / Maize - Healthy',
    crop: 'Corn',
    stage: 'Vegetative',
    soil: 'Black Cotton',
    ph: 6.8,
    moisture: 45,
    temp: 29,
    rainProb: 20,
    location: 'Aurangabad Plains, MH',
    imageLabel: 'Vibrant Green Maize Foliage',
    svgType: 'healthy',
    isDiseased: false
  },
  potato_blight: {
    name: 'Potato - Late Blight',
    crop: 'Potato',
    stage: 'Tuber Initiation',
    soil: 'Clay Loam',
    ph: 6.0,
    moisture: 75,
    temp: 21,
    rainProb: 80,
    location: 'Shimla Foothills, HP',
    imageLabel: 'Water-soaked lesions on Potato Leaf',
    svgType: 'blight',
    isDiseased: true
  },
  apple_scab: {
    name: 'Apple - Scab Lesion',
    crop: 'Apple',
    stage: 'Fruiting',
    soil: 'Sandy Loam',
    ph: 6.5,
    moisture: 52,
    temp: 19,
    rainProb: 40,
    location: 'Kashmir Orchard, JK',
    imageLabel: 'Olive-green velvety spots on Apple Foliage',
    svgType: 'scab',
    isDiseased: true
  }
};

/**
 * Client-Side Guardrail: Validates that an image contains agricultural foliage.
 */
async function validateClientLeafImage(imageFile) {
  if (!imageFile) {
    return {
      isValid: false,
      reason: 'empty_file',
      message: 'No image file received.',
      retry_message: 'Please retry by selecting a valid crop leaf photo.',
      suggestions: ['Please upload a valid JPEG, PNG, or WebP photo.']
    };
  }

  // If HTML Image/Blob, analyze pixel HSV spectrum and texture variation via canvas
  if (imageFile instanceof Blob || imageFile instanceof File) {
    try {
      const bitmap = await createImageBitmap(imageFile);
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, 64, 64);
      const imgData = ctx.getImageData(0, 0, 64, 64);
      const data = imgData.data;

      let plantPixels = 0;
      let blueCyanPixels = 0;
      let totalPixels = 64 * 64;
      let totalR = 0, totalG = 0, totalB = 0;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        totalR += r; totalG += g; totalB += b;

        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        const s = max === 0 ? 0 : d / max;
        const v = max / 255;
        let h = 0;
        if (d !== 0) {
          if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
          else if (max === g) h = ((b - r) / d + 2) * 60;
          else h = ((r - g) / d + 4) * 60;
        }

        // 1. Green / lime / yellow-green / olive foliage
        const isGreen = (h >= 20 && h <= 175 && s >= 0.10 && v >= 0.10);
        // 2. Chlorotic yellow / amber / golden foliage
        const isYellow = (h >= 14 && h < 45 && s >= 0.12 && v >= 0.15);
        // 3. Necrotic foliar brown / rust lesions
        const isBrown = (h >= 4 && h < 30 && s >= 0.12 && v >= 0.08 && v <= 0.90);
        // 4. Dark necrotic / black rot spots
        const isDarkSpot = (h >= 3 && h <= 45 && s >= 0.06 && v >= 0.05 && v <= 0.40);
        // 5. Reddish/purplish stress (anthocyanins / leaf curl)
        const isRedPurple = ((h <= 12 || h >= 335) && s >= 0.15 && v >= 0.15);
        // 6. Powdery mildew / silvery lesions
        const isMildew = (h >= 18 && h <= 170 && s >= 0.05 && s <= 0.40 && v >= 0.45);

        // Blue / cyan non-plant check (sky, clothing, screen, vehicle)
        const isBlueCyan = (h >= 180 && h <= 260 && s >= 0.20 && v >= 0.20);
        if (isBlueCyan) {
          blueCyanPixels++;
        }

        if (isGreen || isYellow || isBrown || isDarkSpot || isRedPurple || isMildew) {
          plantPixels++;
        }
      }

      // Check standard deviation / blank frame
      const avgR = totalR / totalPixels;
      let varianceSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        varianceSum += Math.pow(data[i] - avgR, 2);
      }
      const stdDev = Math.sqrt(varianceSum / totalPixels);
      if (stdDev < 7) {
        return {
          isValid: false,
          reason: 'monotone_or_blank',
          message: 'The uploaded image appears solid-colored, blank, or lacks leaf texture.',
          retry_message: 'Please ensure camera lens is unobstructed and retry capturing the crop leaf.',
          vegetationRatio: 0.0,
          suggestions: ['Take a clear close-up photograph of a plant leaf.']
        };
      }

      const ratio = plantPixels / totalPixels;
      const blueRatio = blueCyanPixels / totalPixels;

      if (blueRatio > 0.35 && ratio < 0.15) {
        return {
          isValid: false,
          reason: 'no_plant_detected',
          message: `Non-crop image detected (dominant non-plant colors: ${(blueRatio * 100).toFixed(1)}%). The image does not contain agricultural crop foliage.`,
          retry_message: 'Please upload a close-up photo focusing directly on a crop leaf rather than sky or background.',
          vegetationRatio: ratio,
          suggestions: [
            'Take a close-up photo of a single crop leaf.',
            'Avoid background objects, sky, or synthetic items.',
            'Focus camera directly on the leaf surface.'
          ]
        };
      }

      // Allow minimum 8% foliage coverage for a valid leaf
      if (ratio < 0.08) {
        return {
          isValid: false,
          reason: 'no_plant_detected',
          message: `No crop leaf detected (foliage index: ${(ratio * 100).toFixed(1)}%). The image does not exhibit organic leaf pigments or foliar lesions.`,
          retry_message: 'Please retry by capturing or uploading a close-up photo of an affected plant leaf in bright natural light.',
          vegetationRatio: ratio,
          suggestions: [
            'Take a close-up photo of a single crop leaf.',
            'Ensure bright, even daylight without glare or heavy shadows.',
            'Focus camera directly on the leaf surface.',
            'Ensure the subject is a supported crop species.'
          ]
        };
      }
      return { isValid: true, vegetationRatio: ratio, retry_message: '' };
    } catch (e) {
      console.warn('Canvas pixel validation bypassed:', e);
    }
  }

  return { isValid: true, vegetationRatio: 0.88, retry_message: '' };
}

/**
 * Mock Disease Prediction
 */
async function mockPredictDisease(imageFile, farmContext = {}) {
  await simulateDelay(600);

  // Client guardrail check
  const val = await validateClientLeafImage(imageFile);
  if (!val.isValid) {
    return {
      status: 'invalid_image',
      title: 'No Crop Leaf Detected',
      reason: val.reason || 'no_plant_detected',
      message: val.message || 'The image does not contain recognizable plant foliage.',
      retry_message: val.retry_message || 'Please retry by uploading a close-up photo of a crop leaf.',
      suggestions: val.suggestions || [
        'Take a close-up photo of a single crop leaf.',
        'Ensure good natural daylight without glare or dark shadows.',
        'Focus camera directly on the affected leaf surface.',
        'Verify your crop is one of our supported species.'
      ],
      vegetation_ratio: val.vegetationRatio || 0.0,
      confidence: 0,
      crop: 'Unrecognized',
      disease: 'Validation Guardrail Triggered'
    };
  }

  const crop = farmContext.cropType || 'Tomato';
  const moisture = Number(farmContext.soilMoisture) || 50;
  const isHealthyPreset = farmContext.isHealthyPreset === true;

  // If flagged as healthy or low moisture with corn
  if (isHealthyPreset || (crop === 'Corn' && moisture < 50)) {
    return {
      status: 'healthy',
      disease: 'Healthy Plant Foliage',
      scientificName: `${crop} spp. (Clean canopy)`,
      confidence: 97.4,
      severity: 'None',
      badgeColor: '#2E7D32',
      summary: `The examined ${crop} leaf exhibits robust cellular turgor, uniform chlorophyll pigmentation, and zero visible signs of fungal or bacterial sporulation.`,
      symptoms: [
        'Uniform green coloration without chlorosis or necrosis',
        'Intact leaf margins and healthy venation architecture',
        'Absence of fungal mycelium, bacterial ooze, or viral mosaic patterns'
      ],
      precautions: {
        organic: 'Continue prophylactic bi-weekly spray of diluted cow-urine/neem decoction (2%) or Trichoderma viride to reinforce systemic resistance.',
        cultural: 'Maintain optimal plant-to-plant spacing (45-60cm) to ensure aerated microclimate.',
        irrigation: 'Keep moisture levels between 40% and 55%. Avoid wetting foliage during sunset.'
      },
      nextInspection: 'Check again in 7 days or after heavy rainfall.'
    };
  }

  // Common crop diseases
  const diseaseProfiles = {
    Tomato: {
      disease: 'Early Blight (Alternaria solani)',
      scientificName: 'Alternaria solani',
      confidence: 94.8,
      severity: moisture > 65 ? 'Moderate to High' : 'Moderate',
      summary: 'Fungal foliar disease characterized by dark brown concentric lesions ("bullseye pattern") starting on the oldest lower foliage.',
      symptoms: [
        'Concentric brown rings encircled by a chlorotic yellow halo',
        'Basal leaf yellowing with progressive upward defoliation',
        'Stems developing dark, sunken circular cankers'
      ],
      precautions: {
        organic: 'Spray cold-pressed Neem Seed Kernel Extract (5%) or Copper Oxychloride @ 2.5g/L. Repeat every 8-10 days.',
        cultural: 'Prune infected bottom leaves up to 30cm off the ground. Mulch with dry straw to prevent spore splash from soil.',
        chemical: 'If >15% leaf area affected, apply Azoxystrobin 23% SC @ 1 ml/L or Chlorothalonil 75% WP @ 2 g/L.'
      }
    },
    Potato: {
      disease: 'Late Blight (Phytophthora infestans)',
      scientificName: 'Phytophthora infestans',
      confidence: 92.3,
      severity: 'High Alert',
      summary: 'Aggressive water-mold pathogen triggered by high humidity and moderate temperatures. Rapid foliar necrosis can occur within 48 hours.',
      symptoms: [
        'Water-soaked dark lesions at leaf tips and margins',
        'White fungal downy growth visible on undersides of leaves in humid mornings',
        'Rapid collapse of canopy accompanied by foul odor'
      ],
      precautions: {
        organic: 'Immediate bio-control spray of Bacillus subtilis (10g/L) and copper hydroxide.',
        cultural: 'Halt all sprinkler irrigation immediately. Burn or deeply bury severely infected vine residues.',
        chemical: 'Apply systemic fungicide Metalaxyl-M + Mancozeb (64% + 4%) @ 2.5g/L immediately.'
      }
    },
    Apple: {
      disease: 'Apple Scab (Venturia inaequalis)',
      scientificName: 'Venturia inaequalis',
      confidence: 91.5,
      severity: 'Moderate',
      summary: 'Fungal infection affecting apple foliage and fruit, producing olive-green velvety spots that turn corky and brown.',
      symptoms: [
        'Dull olive-green to black circular spots on upper leaf surfaces',
        'Crinkled, distorted leaves that drop prematurely',
        'Fruit cracking and scabby blemishes'
      ],
      precautions: {
        organic: 'Sulphur 80% WDG @ 3g/L or potassium bicarbonate spray before wetting periods.',
        cultural: 'Rake and shred fallen leaves in autumn to disrupt overwintering pseudothecia.',
        chemical: 'Myclobutanil 10% WP or Difenoconazole 25% EC @ 0.5 ml/L.'
      }
    },
    Wheat: {
      disease: 'Yellow / Stripe Rust (Puccinia striiformis)',
      scientificName: 'Puccinia striiformis f. sp. tritici',
      confidence: 89.6,
      severity: 'Moderate',
      summary: 'Airborne fungal rust causing bright yellow pustules arranged in linear stripes between leaf veins.',
      symptoms: [
        'Yellow pustules containing powdery urediniospores along vein lines',
        'Reduced grain filling and chlorotic streaks',
        'Stunted flag leaves'
      ],
      precautions: {
        organic: 'Spray sour buttermilk (chaas) solution fermented with copper vessel @ 50ml/L.',
        cultural: 'Plant rust-resistant certified cultivars; avoid excessive nitrogen top-dressing.',
        chemical: 'Propiconazole 25% EC @ 1ml/L at first appearance of stripe pustules.'
      }
    },
    Rice: {
      disease: 'Bacterial Leaf Blight (Xanthomonas oryzae)',
      scientificName: 'Xanthomonas oryzae pv. oryzae',
      confidence: 93.1,
      severity: 'Moderate to High',
      summary: 'Vascular bacterial infection creating water-soaked translucent stripes along leaf margins with milky bacterial beads.',
      symptoms: [
        'Wavy, straw-colored lesions progressing from leaf tips down the margins',
        'Milky bacterial exudate droplets visible during humid dawns',
        'Premature drying of entire tillers (kresek phase)'
      ],
      precautions: {
        organic: 'Spray fresh cow-dung filtrate (20%) mixed with turmeric powder (2g/L).',
        cultural: 'Drain paddy water for 3 days to lower humidity; stop nitrogen fertilizers.',
        chemical: 'Streptocycline 9:1 @ 0.1g/L + Copper Oxychloride @ 1.5g/L.'
      }
    },
    Corn: {
      disease: 'Southern Corn Leaf Blight (Bipolaris maydis)',
      scientificName: 'Bipolaris maydis',
      confidence: 88.7,
      severity: 'Moderate',
      summary: 'Elongated tan lesions with reddish-brown borders between veins on maize leaves.',
      symptoms: [
        'Small diamond-shaped lesions expanding parallel to leaf veins',
        'Premature drying of ear leaves',
        'Stalk rot vulnerability in mature stands'
      ],
      precautions: {
        organic: 'Foliar spray of neem seed extract and bio-fertilizer mix.',
        cultural: 'Deep summer plowing to bury crop debris.',
        chemical: 'Mancozeb 75 WP @ 2g/L.'
      }
    }
  };

  const selectedDisease = diseaseProfiles[crop] || diseaseProfiles.Tomato;

  return {
    status: 'diseased',
    disease: selectedDisease.disease,
    scientificName: selectedDisease.scientificName,
    confidence: selectedDisease.confidence,
    severity: selectedDisease.severity,
    badgeColor: selectedDisease.severity.includes('High') ? '#D32F2F' : '#E65100',
    summary: selectedDisease.summary,
    symptoms: selectedDisease.symptoms,
    precautions: selectedDisease.precautions,
    nextInspection: 'Re-inspect in 48 hours to assess control efficacy.'
  };
}

/**
 * Mock Crop Recommendation
 */
async function mockRecommendCrop(soilData = {}) {
  await simulateDelay(650);

  const ph = Number(soilData.ph) || 6.5;
  const moisture = Number(soilData.moisture) || 45;
  const soilType = soilData.soilType || 'Loamy';
  const loc = soilData.location || 'Surat, Gujarat';

  return {
    analysisTimestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    zone_name: loc.toLowerCase().includes('punjab') ? 'Indo-Gangetic Plains' : (loc.toLowerCase().includes('nashik') || loc.toLowerCase().includes('maharashtra') ? 'Maharashtra / Deccan Plateau' : 'Gujarat / Western Semi-Arid Zone'),
    location_analyzed: loc,
    parametersEvaluated: {
      location: loc,
      soilType,
      ph,
      moisture: `${moisture}%`,
      climateCategory: 'Semi-Arid to Sub-Tropical'
    },
    recommendations: [
      {
        id: 'chickpea',
        rank: 1,
        name: 'Chickpeas / Bengal Gram',
        botanicalName: 'Cicer arietinum',
        matchScore: 96,
        badge: 'Top Match',
        waterRequirement: 'Low (250-300 mm)',
        harvestDuration: '95 - 110 Days',
        expectedYield: '2.4 - 2.8 Ton / Hectare',
        profitPotential: 'Very High',
        rationale: `Optimal match for current soil pH (${ph}) and ${soilType} soil. High drought resilience and atmospheric nitrogen-fixing nodules will naturally replenish depleted soil nutrients for your next crop cycle.`,
        keyAdvantage: 'High market demand with low irrigation costs.'
      },
      {
        id: 'wheat',
        rank: 2,
        name: 'Wheat (Durum / Sharbati)',
        botanicalName: 'Triticum aestivum',
        matchScore: 91,
        badge: 'High Yield',
        waterRequirement: 'Medium (400-450 mm)',
        harvestDuration: '115 - 125 Days',
        expectedYield: '4.2 - 5.0 Ton / Hectare',
        profitPotential: 'High',
        rationale: `Current ambient temperatures and well-draining ${soilType} profile provide superior crown-root initiation conditions. Highly responsive to current soil moisture levels.`,
        keyAdvantage: 'Stable MSP government procurement guarantee.'
      },
      {
        id: 'mustard',
        rank: 3,
        name: 'Yellow Mustard',
        botanicalName: 'Brassica campestris',
        matchScore: 86,
        badge: 'Low Water',
        waterRequirement: 'Low (200-250 mm)',
        harvestDuration: '85 - 95 Days',
        expectedYield: '1.8 - 2.2 Ton / Hectare',
        profitPotential: 'High',
        rationale: 'Thrives in mildly acidic to neutral soil. Requires only 2 critical irrigations (flowering and siliqua development stages), conserving up to 40% more groundwater.',
        keyAdvantage: 'Short crop turnaround with immediate cash-crop liquidity.'
      },
      {
        id: 'maize',
        rank: 4,
        name: 'Hybrid Maize / Corn',
        botanicalName: 'Zea mays',
        matchScore: 79,
        badge: 'Nutrient Rich',
        waterRequirement: 'Medium-High (500 mm)',
        harvestDuration: '90 - 105 Days',
        expectedYield: '6.0 - 7.5 Ton / Hectare',
        profitPotential: 'Moderate to High',
        rationale: `Suitable for ${soilType} soil with good organic matter. Requires scheduled drip irrigation during tasseling and silking to reach full yield potential.`,
        keyAdvantage: 'Dual purpose grain and dairy silage fodder value.'
      }
    ]
  };
}

/**
 * Mock Smart Irrigation Advice
 */
async function mockGetIrrigationAdvice(data = {}) {
  await simulateDelay(550);

  const moisture = Number(data.moisture ?? 42);
  const rainProb = Number(data.rainProb ?? 65);
  const temp = Number(data.temp ?? 28);
  const crop = data.crop || 'Tomato';
  const evapo = temp > 25 ? (3.2 + (temp - 25) * 0.15).toFixed(1) : '3.2';

  if (rainProb >= 60 && moisture > 35) {
    return {
      needed: false,
      decisionType: 'delay',
      decision: `Irrigation Delayed — Rain Incoming (${Math.round(rainProb)}%)`,
      reasoning: `Upcoming precipitation forecast of <strong>${Math.round(rainProb)}%</strong> is expected within the next 24 hours. Current soil moisture (${moisture}%) is above critical threshold for ${crop}. Postponing irrigation will conserve water and prevent waterlogging root stress.`,
      metrics: {
        soilMoisture: moisture,
        rainForecast24h: `${Math.round(rainProb)}% (8-12 mm)`,
        temperature: temp,
        evapotranspiration: `${evapo} mm/d`,
        waterSaved: '16,500 L',
        crop: crop,
        location: 'Current Farm'
      },
      schedule: {
        optimalWindow: 'Hold off; re-evaluate after rain passes',
        runTime: '0 Minutes (Standby Mode)',
        recommendedVolumePerSqm: 0.0
      }
    };
  }

  if (temp > 35 && rainProb < 50) {
    return {
      needed: true,
      decisionType: 'heatwave',
      decision: `Heatwave Stress Override — Cooling Pulse (${Math.round(temp)}°C)`,
      reasoning: `Extreme ambient temperature of <strong>${temp}°C</strong> detected. Solar vaporisation rate is spiked at ${evapo} mm/day. A light 15-minute drip pulse is advised to cool root beds and prevent flower drop.`,
      metrics: {
        soilMoisture: moisture,
        rainForecast24h: `${Math.round(rainProb)}% (< 2 mm)`,
        temperature: temp,
        evapotranspiration: `${evapo} mm/d`,
        waterSaved: '4,200 L',
        crop: crop,
        location: 'Current Farm'
      },
      schedule: {
        optimalWindow: 'Late Afternoon (04:30 PM – 06:00 PM)',
        runTime: '15 Minutes (Canopy Cooling Pulse)',
        recommendedVolumePerSqm: 1.2
      }
    };
  }

  if (moisture < 35 && rainProb < 45) {
    return {
      needed: true,
      decisionType: 'needed',
      decision: 'YES — Irrigation Recommended (Apply 3.5 L/m²)',
      reasoning: `Soil moisture (<strong>${moisture}%</strong>) has dropped below the critical threshold for ${crop}. With low rain probability (${Math.round(rainProb)}%) and temperature at ${temp}°C, scheduled drip irrigation is recommended to prevent drought stress.`,
      metrics: {
        soilMoisture: moisture,
        rainForecast24h: `${Math.round(rainProb)}% (< 2 mm)`,
        temperature: temp,
        evapotranspiration: `${evapo} mm/d`,
        waterSaved: '0 L (Irrigation Active)',
        crop: crop,
        location: 'Current Farm'
      },
      schedule: {
        optimalWindow: 'Tomorrow, 5:30 AM – 7:30 AM (Low Evaporation)',
        runTime: '60 Minutes (Active Drip Cycle)',
        recommendedVolumePerSqm: 3.5
      }
    };
  }

  return {
    needed: false,
    decisionType: 'optimal',
    decision: `Soil Moisture Optimal (${moisture}%) — Standby`,
    reasoning: `Current root zone moisture (<strong>${moisture}%</strong>) is comfortably within the healthy turgor buffer for ${crop}. Atmospheric conditions are stable with ${Math.round(rainProb)}% rain probability. Supplemental watering today is unnecessary.`,
    metrics: {
      soilMoisture: moisture,
      rainForecast24h: `${Math.round(rainProb)}% (< 2 mm)`,
      temperature: temp,
      evapotranspiration: `${evapo} mm/d`,
      waterSaved: '12,000 L',
      crop: crop,
      location: 'Current Farm'
    },
    schedule: {
      optimalWindow: 'Next scheduled check in 12–24 hours',
      runTime: '0 Minutes (Standby Mode)',
      recommendedVolumePerSqm: 0.0
    }
  };
}

/**
 * Mock Weather Advice
 */
async function mockGetWeatherAdvice(location = 'Nashik Valley, MH') {
  await simulateDelay(500);

  return {
    location,
    updatedTime: 'Just now (Live Station Sync)',
    current: {
      temp: 28,
      feelsLike: 30,
      condition: 'Partly Cloudy with Approaching Showers',
      conditionCode: 'partly-cloudy-rain',
      humidity: 74,
      rainProb: 65,
      windSpeed: 14,
      windDirection: 'SW (210°)',
      uvIndex: 5,
      barometer: 1011
    },
    actionBanners: [
      {
        id: 'banner-rain',
        level: 'warning',
        title: 'Postpone Irrigation Cycle',
        icon: 'cloud-rain',
        description: 'Precipitation probable (65%, 16-20 mm) within 18-24 hours. Delaying scheduled watering preserves aquifer water and prevents soil compaction.'
      },
      {
        id: 'banner-fungal',
        level: 'alert',
        title: 'Elevated Fungal Spore Alert',
        icon: 'shield-alert',
        description: 'Prolonged relative humidity (>70%) and 26-29°C temperature promote early blight and downy mildew sporulation. Scout susceptible crops.'
      },
      {
        id: 'banner-spray',
        level: 'success',
        title: 'Foliar Spraying Window Available',
        icon: 'wind',
        description: 'Wind speeds remain below 15 km/h until 4:30 PM today. Favorable for bio-stimulant or foliar micronutrient spray with minimal drift.'
      }
    ],
    forecast: [
      {
        day: 'Today',
        date: '11 Sep',
        condition: 'Showers Likely',
        icon: 'rain',
        tempHigh: 29,
        tempLow: 21,
        rainProb: 65,
        humidity: 74,
        advisory: 'Clear drainage channels; hold irrigation.'
      },
      {
        day: 'Tomorrow',
        date: '12 Sep',
        condition: 'Scattered Rain',
        icon: 'rain',
        tempHigh: 27,
        tempLow: 20,
        rainProb: 75,
        humidity: 82,
        advisory: 'High fungal risk; check lower leaf canopies.'
      },
      {
        day: 'Thursday',
        date: '13 Sep',
        condition: 'Passing Clouds',
        icon: 'cloud-sun',
        tempHigh: 30,
        tempLow: 21,
        rainProb: 25,
        humidity: 62,
        advisory: 'Good day for field weeding and aeration.'
      },
      {
        day: 'Friday',
        date: '14 Sep',
        condition: 'Sunny & Clear',
        icon: 'sun',
        tempHigh: 32,
        tempLow: 22,
        rainProb: 10,
        humidity: 50,
        advisory: 'Resume scheduled morning drip fertigation.'
      },
      {
        day: 'Saturday',
        date: '15 Sep',
        condition: 'Warm & Breezy',
        icon: 'sun-wind',
        tempHigh: 33,
        tempLow: 23,
        rainProb: 5,
        humidity: 46,
        advisory: 'Monitor soil moisture; apply root mulch.'
      }
    ]
  };
}

/**
 * Mock Sustainability Score
 */
async function mockGetSustainabilityScore(data = {}) {
  await simulateDelay(150);

  const crop = data.crop || 'Tomato';
  const area = Number(data.area_hectares ?? data.areaHectares ?? 2.0);
  const waterUsed = Number(data.water_used_liters ?? data.waterUsedLiters ?? 35000);
  const fertilizer = Number(data.fertilizer_kg_per_hectare ?? data.fertilizerKgPerHa ?? 45);
  const diseaseDetected = Boolean(data.disease_detected ?? data.diseaseDetected);
  const irrigationMethod = String(data.irrigation_method ?? data.irrigationMethod ?? 'drip').toLowerCase().trim();
  const pesticideUsed = Boolean(data.pesticide_used ?? data.pesticideUsed);

  const refWaterMap = {
    'Tomato': 28000,
    'Potato': 25000,
    'Wheat': 25000,
    'Rice': 60000,
    'Maize': 30000,
    'Cotton': 35000,
    'Sugarcane': 55000,
    'Banana': 50000,
  };
  const refPerHa = refWaterMap[crop] || 28000;
  const refTotal = refPerHa * area;

  // 1. Water score
  const waterScore = waterUsed <= 0 ? 100 : Math.round(Math.min(refTotal / waterUsed, 1.0) * 1000) / 10;

  // 2. Fertilizer score
  let fertScore = 100;
  if (fertilizer > 40) {
    fertScore = Math.max(0, Math.round((100 - (fertilizer - 40) * 2) * 10) / 10);
  }

  // 3. Disease score
  const diseaseScore = diseaseDetected ? 40.0 : 100.0;

  // 4. Irrigation method score
  const methodScores = { drip: 100, sprinkler: 75, furrow: 50, flood: 30 };
  const methodScore = methodScores[irrigationMethod] || 20;

  // Composite weighted score
  const overall = Math.round((waterScore * 0.35 + fertScore * 0.25 + diseaseScore * 0.20 + methodScore * 0.20) * 10) / 10;

  let grade = 'F';
  if (overall >= 90) grade = 'A';
  else if (overall >= 75) grade = 'B';
  else if (overall >= 60) grade = 'C';
  else if (overall >= 45) grade = 'D';

  const tierLabel = overall >= 90 ? 'Tier 1: Eco-Certified Leader'
    : overall >= 75 ? 'Tier 2: Progressive Conservationist'
    : overall >= 60 ? 'Tier 3: Moderate Efficiency Farm'
    : 'Tier 4: High Resource Footprint';

  const waterMetric = `${waterScore}/100 • ${waterScore >= 85 ? 'Tier 1 Efficiency' : waterScore >= 60 ? 'Moderate Efficiency' : 'Excess Withdrawal'}`;
  const waterSummary = waterScore >= 85
    ? 'Micro-drip deployment reduces runoff and evaporation losses significantly.'
    : waterScore >= 60
    ? 'Water withdrawal is moderate. Early morning scheduling can improve retention.'
    : 'Water consumption is significantly above FAO regional reference volume for this crop.';

  const fertMetric = `${fertScore}/100 • ${fertScore >= 90 ? 'Optimal Dosage' : fertScore >= 60 ? 'Moderate Usage' : 'Excess Chemical Risk'}`;
  const fertSummary = fertScore >= 90
    ? 'Balanced nutrient application within ideal range (20–40 kg/ha).'
    : fertScore >= 60
    ? 'Slightly elevated fertilizer dosage increases nitrate leaching vulnerability.'
    : 'High fertilizer application causes soil acidification and significant runoff loss.';

  const methodCapitalized = irrigationMethod.charAt(0).toUpperCase() + irrigationMethod.slice(1);
  const irrigMetric = `${methodScore}/100 • ${methodCapitalized} Method`;
  const irrigSummary = methodScore >= 90
    ? 'High-efficiency drip lines deliver water directly to the crop root zone.'
    : methodScore >= 70
    ? 'Sprinklers provide uniform coverage with moderate aerial evaporative loss.'
    : methodScore >= 45
    ? 'Furrow distribution leads to moderate seepage and non-uniform infiltration.'
    : 'Flood irrigation causes substantial surface evaporation, nutrient runoff, and waterlogging.';

  const diseaseMetric = `${diseaseScore}/100 • ${diseaseScore >= 90 ? 'Healthy Canopy' : 'Infection Stress'}`;
  const diseaseSummary = diseaseScore >= 90
    ? 'No active pathogen detected. Robust plant immunity and canopy health maintained.'
    : 'Active pathogen outbreak detected, causing physiological stress and necessitating treatment.';

  const suggestions = [];
  if (waterScore < 70) {
    suggestions.append ? null : suggestions.push({
      impact: 'High Impact',
      title: 'Irrigation Timing & Volume Optimization',
      description: `Water use efficiency is low (${waterScore}/100). Switch to drip or sprinkler irrigation and schedule in early morning to reduce evaporation.`
    });
  }
  if (methodScore < 75) {
    suggestions.push({
      impact: 'High Impact',
      title: 'Upgrade Water Delivery Infrastructure',
      description: `Current irrigation method (${irrigationMethod}) has low water efficiency. Upgrading to drip irrigation can reduce water consumption by 30-50%.`
    });
  }
  if (fertScore < 75) {
    suggestions.push({
      impact: 'High Impact',
      title: 'Nutrient Split-Dosing & Soil Testing',
      description: `Fertilizer application (${fertilizer} kg/ha) exceeds optimal range (20-40 kg/ha). Consider soil testing and split-application to reduce waste and runoff.`
    });
  }
  if (diseaseDetected) {
    suggestions.push({
      impact: 'Urgent Action',
      title: 'Biosecurity & Targeted Disease Control',
      description: 'Disease was detected this week. Early treatment reduces crop loss and reduces the need for repeated chemical applications.'
    });
  }
  if (pesticideUsed) {
    suggestions.push({
      impact: 'Medium Impact',
      title: 'Integrated Pest Management (IPM)',
      description: 'Pesticide use detected. Where possible, opt for IPM: biocontrol agents, resistant varieties, and pheromone traps to reduce chemical load.'
    });
  }
  if (suggestions.length === 0) {
    suggestions.push({
      impact: 'Elite Practice',
      title: 'Outstanding Sustainable Operations',
      description: 'All monitored resource metrics are within optimal conservation limits. Keep up the disciplined stewardship!'
    });
  }

  return {
    overallScore: overall,
    grade,
    tier: tierLabel,
    breakdown: [
      {
        pillar: 'Water Efficiency',
        score: waterScore,
        color: '#0288D1',
        summary: waterSummary,
        metric: waterMetric
      },
      {
        pillar: 'Chemical Reduction',
        score: fertScore,
        color: '#E65100',
        summary: fertSummary,
        metric: fertMetric
      },
      {
        pillar: 'Irrigation & Energy',
        score: methodScore,
        color: '#2E7D32',
        summary: irrigSummary,
        metric: irrigMetric
      },
      {
        pillar: 'Foliar & Plant Health',
        score: diseaseScore,
        color: '#7B1FA2',
        summary: diseaseSummary,
        metric: diseaseMetric
      }
    ],
    suggestions,
    metrics: {
      crop,
      areaHectares: area,
      waterUsedLiters: waterUsed,
      fertilizerKgPerHa: fertilizer,
      irrigationMethod,
      diseaseDetected,
      pesticideUsed
    }
  };
}

/**
 * Mock Multi-Language Farmer Assistant
 */
async function mockAskAssistant(question = '', language = 'en') {
  await simulateDelay(700);

  const q = question.toLowerCase();

  const localizedResponses = {
    hi: {
      blight: 'टमाटर की अगेती झुलसा (अर्ली ब्लाइट) के लिए 5% नीम तेल या कॉपर ऑक्सीक्लोराइड 2.5 ग्राम प्रति लीटर पानी में मिलाकर सुबह के समय छिड़कें। संक्रमित निचली पत्तियों को तुरंत हटा दें और पानी सीधे जड़ों में दें, पत्तियों पर नहीं।',
      irrigation: 'वर्तमान मौसम और नमी के अनुसार, यदि आगामी 24 घंटे में बारिश की संभावना है तो सिंचाई टालें। हमेशा ड्रिप सिंचाई का उपयोग करें और सुबह के समय पानी दें।',
      fertilizer: 'फूल आने की अवस्था में पोटाश और बोरॉन का संतुलित उपयोग करें। अत्यधिक यूरिया देने से बचें क्योंकि इससे कीटों का प्रकोप बढ़ता है। जैविक खाद या वर्मीकम्पोस्ट का प्रयोग सबसे बेहतर है।',
      default: `नमस्ते किसान साथी! आपके प्रश्न "${question}" के संदर्भ में हमारी सलाह है: अपनी मिट्टी की नियमित जांच कराएं, मौसम के अनुसार ही सिंचाई करें और जैविक कीटनाशक अपनाएं। आप फसल रोग, खाद या सिंचाई से संबंधित कोई भी सवाल पूछ सकते हैं!`
    },
    mr: {
      blight: 'टोमॅटोवरील करपा रोगासाठी कॉपर ऑक्झिक्लोराईड २.५ ग्रॅम किंवा निंबोळी अर्क ५% प्रति लिटर पाण्यात मिसळून फवारणी करावी. बाधित पाने काढून नष्ट करा व ठिबक सिंचनानेच पाणी द्या.',
      irrigation: 'मातीतील ओलावा तपासूनच पाणी द्या. हवामान खात्याने पावसाचा अंदाज दिल्यास पाणी देणे टाळावे, जेणेकरून मुळांना ऑक्सिजन मिळेल.',
      fertilizer: 'पिकाच्या फुलधारणा काळात फॉस्फरस आणि पोटॅशयुक्त खतांचा वापर करा. ट्रायकोडर्मा आणि सेंद्रिय खतांचा वापर वाढवा.',
      default: `नमस्कार शेतकरी मित्र! आपल्या प्रश्नासाठी आमचा सल्ला: हवामान अंदाज पाहून शेतीची कामे करा. रोग नियंत्रण किंवा खत व्यवस्थापनाबद्दल अधिक माहिती हवी असल्यास नक्की विचारा!`
    },
    te: {
      blight: 'టమాటా ఆకుమచ్చ లేదా బ్లైట్ తెగులు నివారణకు కాపర్ ఆక్సీక్లోరైడ్ 2.5 గ్రా/లీటర్ లేదా వేప నూనెను పిచికారీ చేయండి. తెగులు సోకిన ఆకులను తీసివేయండి.',
      irrigation: 'వర్ష సూచన ఉన్నప్పుడు నీటిపారుదల ఆపండి. డ్రిప్ విధానం ద్వారా మాత్రమే నీరు అందించడం వల్ల నీరు ఆదా అవుతుంది.',
      fertilizer: 'పూత మరియు కాయ దశలలో పొటాష్ మరియు జింక్ సూక్ష్మపోషకాలను పిచికారీ చేయడం వల్ల అధిక దిగుబడి వస్తుంది.',
      default: `నమస్కారం రైతు మిత్రమా! మీ పంటల సంరక్షణ, ఎరువుల నిర్వహణ మరియు నీటిపారుదల సలహాల కోసం ఎప్పుడైనా అడగండి.`
    },
    es: {
      blight: 'Para el tizón temprano, aplique oxicloruro de cobre a 2.5 g/L o extracto de aceite de neem al 5% por la mañana. Pode las hojas inferiores afectadas y use riego por goteo.',
      irrigation: 'Retrase el riego si hay pronóstico de lluvia en las próximas 24 horas. Esto evita el encharcamiento y la proliferación de hongos.',
      fertilizer: 'Durante la floración, aplique potasio y micronutrientes como boro. Evite el exceso de nitrógeno sintético.',
      default: `¡Hola agricultor! En respuesta a su consulta: le recomendamos monitorear la humedad del suelo y seguir las alertas climáticas. ¿Tiene preguntas sobre plagas, riego o fertilización?`
    },
    en: {
      blight: `**Early Blight Management Strategy:**\n1. **Bio-Fungicide:** Spray cold-pressed Neem Oil (0.5%) or Copper Oxychloride @ 2.5g/L every 8-10 days in early morning.\n2. **Sanitation:** Prune lower leaves up to 30 cm from ground level to break the soil-splash transmission path.\n3. **Moisture Control:** Strictly avoid overhead sprinkling; switch to root-zone drip lines.`,
      irrigation: `**Smart Irrigation Guidance:**\n- Current soil moisture is holding at adequate reserve levels.\n- With the approaching weather front, delay automated pumping to save energy and protect roots from anoxia.\n- Water early at dawn (5:30 AM) when you next irrigate to cut evaporation by 18%.`,
      fertilizer: `**Balanced Nutrition Recommendations:**\n- **Flowering/Fruiting Stage:** Focus on Potassium (K) and Boron for blossom retention and fruit sizing.\n- **Nitrogen Control:** Avoid high-urea top dressing in humid spells, as soft vegetative flushes invite fungal spores and aphids.\n- **Soil Conditioning:** Apply 2-3 tons/acre well-decomposed vermicompost fortified with *Trichoderma*.`,
      pests: `**Integrated Pest Scouting:**\n- Install yellow sticky traps (10-12 per acre) to monitor whiteflies and thrips.\n- Plant border rows of African Marigolds to divert root-knot nematodes and lepidopteran pests.\n- Use Beauveria bassiana bio-pesticide spray at dusk for sucking pests.`,
      default: `**AgriSmart Field Advisor Response:**\nThank you for your question regarding **"${question}"**.\n\n- **Immediate Action:** Scout 10 random plants diagonally across your plot for early signs of stress.\n- **Microclimate Note:** Current relative humidity is elevated, so ensure plant canopies receive adequate airflow.\n- **Tip:** You can ask me specific questions about dosage calculations, disease treatments, organic recipes, or harvest timing!`
    }
  };

  const langPack = localizedResponses[language] || localizedResponses.en;

  if (q.includes('blight') || q.includes('disease') || q.includes('spot') || q.includes('fung') || q.includes('रोग') || q.includes('करपा') || q.includes('తెగులు') || q.includes('hongo')) {
    return { text: langPack.blight, language, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
  }
  if (q.includes('water') || q.includes('irrigat') || q.includes('rain') || q.includes('सिंचाई') || q.includes('पाणी') || q.includes('నీరు') || q.includes('riego')) {
    return { text: langPack.irrigation, language, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
  }
  if (q.includes('fertiliz') || q.includes('urea') || q.includes('npk') || q.includes('खाद') || q.includes('खत') || q.includes('ఎరువు') || q.includes('fertilizante')) {
    return { text: langPack.fertilizer, language, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
  }
  if (language === 'en' && (q.includes('pest') || q.includes('bug') || q.includes('insect') || q.includes('worm'))) {
    return { text: langPack.pests, language, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
  }

  return { text: langPack.default, language, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
}

/**
 * Mock Agentic Advisor Feed
 */
const initialAgenticEvents = [
  {
    id: 'evt-1',
    time: '2:15 PM Today',
    timestamp: Date.now() - 1000 * 60 * 45,
    type: 'autonomous',
    badge: 'Autonomous Action',
    badgeClass: 'badge-autonomous',
    title: 'Postponed Scheduled Drip Valve #3',
    trigger: 'Rain Radar threshold crossed 60% probability (18mm projected)',
    reasoning: 'Soil moisture is currently at 42%. Running scheduled 3:00 PM irrigation would saturate root zones, leach active nitrogen, and waste 14,000L water.',
    actionTaken: 'Auto-paused smart valve #3 until tomorrow 8:00 AM. Sent SMS notification to farmer.',
    status: 'Executed'
  },
  {
    id: 'evt-2',
    time: '11:40 AM Today',
    timestamp: Date.now() - 1000 * 60 * 200,
    type: 'alert',
    badge: 'Pathogen Alert',
    badgeClass: 'badge-alert',
    title: 'Fungal Sporulation Risk Flagged for Block B (Tomatoes)',
    trigger: 'Ambient humidity sustained above 72% for 6 consecutive hours at 28°C',
    reasoning: 'Conditions have crossed the threshold for Alternaria solani spore germination. Historical data shows early detection prevents 80% of crop loss.',
    actionTaken: 'Generated preventative biopesticide recommendation and added alert to Farmer Dashboard.',
    status: 'Farmer Review'
  },
  {
    id: 'evt-3',
    time: '8:05 AM Today',
    timestamp: Date.now() - 1000 * 60 * 420,
    type: 'routine',
    badge: 'Autonomous Optimization',
    badgeClass: 'badge-routine',
    title: 'Calibrated Soil Moisture Tensiometer Sensor #4',
    trigger: 'Daily morning sensor diagnostic routine',
    reasoning: 'Detected slight baseline drift (+2.1%) due to temperature swing. Compensated calibration curve.',
    actionTaken: 'Recalibrated telemetry coefficients; synced verified moisture baseline (42%).',
    status: 'Completed'
  },
  {
    id: 'evt-4',
    time: '6:30 PM Yesterday',
    timestamp: Date.now() - 1000 * 60 * 1250,
    type: 'scheduled',
    badge: 'Scheduled Run',
    badgeClass: 'badge-scheduled',
    title: 'Completed Solar Fertigation Injection (Micro-Dose K)',
    trigger: 'Weekly potassium schedule matched peak solar inverter output',
    reasoning: 'Injecting soluble potassium while solar power is peak (4.2 kW) maximizes drip head pressure at zero grid energy cost.',
    actionTaken: 'Injected 2.5 kg Potassium Sulfate across 2.5 acres. Total water used: 8,200L.',
    status: 'Completed'
  }
];

let dynamicAgenticEvents = [...initialAgenticEvents];

async function mockGetAgenticFeed() {
  await simulateDelay(450);
  return [...dynamicAgenticEvents];
}

/**
 * Generate a new live autonomous event on demand (e.g. for "Trigger Agent Check" button)
 */
async function mockGenerateAgentEvent() {
  await simulateDelay(600);

  const eventTemplates = [
    {
      title: 'Solar Inverter Priority Switch Engaged',
      badge: 'Autonomous Action',
      badgeClass: 'badge-autonomous',
      trigger: 'Solar irradiance spiked to 850 W/m²',
      reasoning: 'Surplus solar energy detected. Activated water pump pre-pressurization to prefill overhead secondary farm cisterns.',
      actionTaken: 'Diverted 2.2 kW solar power to tank pump. Stored 3,500L clean reservoir water without grid usage.'
    },
    {
      title: 'Soil pH Anomaly Detected in Sector 3',
      badge: 'Pathogen Alert',
      badgeClass: 'badge-alert',
      trigger: 'Sector 3 soil probe recorded sudden dip to pH 5.8',
      reasoning: 'Heavy localized runoff caused mild acid wash. Crop is sensitive to aluminum toxicity below pH 6.0.',
      actionTaken: 'Scheduled agricultural lime buffering advisory for upcoming fertigation cycle.'
    },
    {
      title: 'Evapotranspiration Index Recalculated',
      badge: 'Autonomous Optimization',
      badgeClass: 'badge-routine',
      trigger: 'Wind speed shift from 8 km/h to 16 km/h',
      reasoning: 'Increased wind velocity accelerates leaf vaporisation by 12%. Recomputed crop water stress coefficient.',
      actionTaken: 'Adjusted target irrigation volume for next cycle by +800 Liters.'
    }
  ];

  const template = eventTemplates[Math.floor(Math.random() * eventTemplates.length)];
  const newEvent = {
    id: 'evt-' + Date.now(),
    time: 'Just now',
    timestamp: Date.now(),
    type: 'autonomous',
    badge: template.badge,
    badgeClass: template.badgeClass,
    title: template.title,
    trigger: template.trigger,
    reasoning: template.reasoning,
    actionTaken: template.actionTaken,
    status: 'Active'
  };

  dynamicAgenticEvents.unshift(newEvent);
  return newEvent;
}

// Export functions to global scope for clean browser usage
window.AgriSmartMock = {
  SAMPLE_LEAF_PRESETS,
  validateClientLeafImage,
  mockPredictDisease,
  mockRecommendCrop,
  mockGetIrrigationAdvice,
  mockGetWeatherAdvice,
  mockGetSustainabilityScore,
  mockAskAssistant,
  mockGetAgenticFeed,
  mockGenerateAgentEvent
};
