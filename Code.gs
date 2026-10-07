/**
 * ============================================================
 * 1) CONFIGURATION GLOBALE
 * ------------------------------------------------------------
 * Paramètres métier et techniques du backend Apps Script.
 * ============================================================
 */
const CONFIG = {
  SHEET_NAME: 'Inscriptions',
  LOG_SHEET_NAME: 'Logs',
  OBJECTIF_KM: 2000,
  MIN_DISTANCE: 0.1,
  MAX_DISTANCE: 200,
  MIN_FORM_OPEN_MS: 2500,
  ALLOWED_TYPES: ['Course', 'Marche', 'Autre'],
  MAX_NAME_LENGTH: 80,
  MAX_PAGE_LENGTH: 500
};

/**
 * ============================================================
 * 2) POINTS D’ENTRÉE WEB APP
 * ------------------------------------------------------------
 * doGet  : lecture des stats
 * doPost : enregistrement d’une inscription
 * ============================================================
 */

/**
 * Point d’entrée GET de la Web App.
 * - GET ?action=stats => retourne les statistiques agrégées
 * - sinon => retourne un message simple de disponibilité API
 */
function doGet(e) {
  try {
    const action = RequestUtils.getParam(e, 'action');

    if (action === 'stats') {
      return ResponseUtils.json(StatsService.getStats());
    }

    return ResponseUtils.json({
      success: true,
      message: 'API active'
    });
  } catch (error) {
    LogService.log('GET_ERROR', {
      message: error.message || String(error)
    });

    return ResponseUtils.json({
      success: false,
      message: 'Erreur serveur'
    });
  }
}

/**
 * Point d’entrée POST de la Web App.
 * Reçoit un payload JSON et tente d’enregistrer une inscription.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      LogService.log('POST_EMPTY', {});
      return ResponseUtils.json({
        success: false,
        message: 'Aucune donnée reçue'
      });
    }

    const payload = JSON.parse(e.postData.contents);
    const validation = ValidationService.validatePayload(payload);

    if (!validation.valid) {
      LogService.log('POST_REJECTED', {
        reason: validation.message,
        nom: Sanitizer.safeLogString(payload.nom),
        prenom: Sanitizer.safeLogString(payload.prenom),
        typeCourse: Sanitizer.safeLogString(payload.typeCourse)
      });

      return ResponseUtils.json({
        success: false,
        message: validation.message
      });
    }

    RegistrationService.save(payload);

    LogService.log('POST_ACCEPTED', {
      nom: Sanitizer.safeLogString(payload.nom),
      prenom: Sanitizer.safeLogString(payload.prenom),
      typeCourse: Sanitizer.safeLogString(payload.typeCourse),
      distance: Number(payload.distance)
    });

    return ResponseUtils.json({
      success: true,
      message: 'Inscription enregistrée'
    });

  } catch (error) {
    LogService.log('POST_ERROR', {
      message: error.message || String(error)
    });

    return ResponseUtils.json({
      success: false,
      message: 'Erreur serveur'
    });
  }
}

/**
 * ============================================================
 * 3) SERVICES MÉTIER
 * ------------------------------------------------------------
 * Regroupe les comportements principaux du backend.
 * ============================================================
 */

/**
 * Service responsable de l’enregistrement d’une inscription.
 */
const RegistrationService = {
  /**
   * Enregistre une inscription validée dans la feuille Google Sheets.
   */
  save(payload) {
    const sheet = SpreadsheetService.getOrCreateSheet(CONFIG.SHEET_NAME);

    sheet.appendRow([
      new Date(),
      payload.nom,
      payload.prenom,
      payload.typeCourse,
      Number(payload.distance),
      Sanitizer.clean(payload.page || '')
    ]);
  }
};

/**
 * Service responsable du calcul et retour des statistiques.
 */
const StatsService = {
  /**
   * Lit toutes les inscriptions et calcule :
   * - nombre de participants
   * - distance totale
   * - objectif
   */
  getStats() {
    const sheet = SpreadsheetService.getOrCreateSheet(CONFIG.SHEET_NAME);
    const values = sheet.getDataRange().getValues();

    if (values.length <= 1) {
      return {
        success: true,
        participants: 0,
        totalDistance: 0,
        objectif: CONFIG.OBJECTIF_KM
      };
    }

    let participants = 0;
    let totalDistance = 0;

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const nom = row[1];
      const prenom = row[2];
      const typeCourse = row[3];
      const distance = Number(row[4]) || 0;

      if (nom || prenom || typeCourse || distance) {
        participants++;
        totalDistance += distance;
      }
    }

    return {
      success: true,
      participants: participants,
      totalDistance: NumberUtils.round1(totalDistance),
      objectif: CONFIG.OBJECTIF_KM
    };
  }
};

/**
 * Service responsable de la validation serveur.
 * Très important : on ne fait jamais confiance au front seul.
 */
const ValidationService = {
  /**
   * Valide et normalise le payload reçu.
   * Retourne :
   * - { valid: true } si OK
   * - { valid: false, message: "..." } sinon
   */
  validatePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return { valid: false, message: 'Données invalides' };
    }

    const nom = Sanitizer.clean(payload.nom);
    const prenom = Sanitizer.clean(payload.prenom);
    const typeCourse = Sanitizer.clean(payload.typeCourse);
    const website = Sanitizer.clean(payload.website);
    const page = Sanitizer.clean(payload.page);
    const distance = Number(payload.distance);
    const formOpenedAt = Number(payload.formOpenedAt);
    const submittedAt = Number(payload.submittedAt);

    // Honeypot : si rempli, comportement suspect
    if (website) {
      return { valid: false, message: 'Soumission rejetée' };
    }

    if (!nom || !prenom || !typeCourse) {
      return { valid: false, message: 'Champs obligatoires manquants' };
    }

    if (nom.length < 2 || prenom.length < 2) {
      return { valid: false, message: 'Nom ou prénom trop court' };
    }

    if (nom.length > CONFIG.MAX_NAME_LENGTH || prenom.length > CONFIG.MAX_NAME_LENGTH) {
      return { valid: false, message: 'Nom ou prénom trop long' };
    }

    if (!CONFIG.ALLOWED_TYPES.includes(typeCourse)) {
      return { valid: false, message: 'Type de course invalide' };
    }

    if (Number.isNaN(distance)) {
      return { valid: false, message: 'Distance invalide' };
    }

    if (distance < CONFIG.MIN_DISTANCE || distance > CONFIG.MAX_DISTANCE) {
      return { valid: false, message: 'Distance hors limites' };
    }

    if (!Number.isFinite(formOpenedAt) || !Number.isFinite(submittedAt)) {
      return { valid: false, message: 'Horodatage invalide' };
    }

    if ((submittedAt - formOpenedAt) < CONFIG.MIN_FORM_OPEN_MS) {
      return { valid: false, message: 'Soumission trop rapide' };
    }

    if (page.length > CONFIG.MAX_PAGE_LENGTH) {
      return { valid: false, message: 'Contexte de page invalide' };
    }

    // Normalisation finale
    payload.nom = nom;
    payload.prenom = prenom;
    payload.typeCourse = typeCourse;
    payload.website = website;
    payload.page = page;
    payload.distance = NumberUtils.round1(distance);
    payload.formOpenedAt = formOpenedAt;
    payload.submittedAt = submittedAt;

    return { valid: true };
  }
};

/**
 * ============================================================
 * 4) SERVICES TECHNIQUES
 * ------------------------------------------------------------
 * Encapsulent l’accès aux feuilles, logs, réponses HTTP, etc.
 * ============================================================
 */

/**
 * Service de manipulation du spreadsheet.
 */
const SpreadsheetService = {
  /**
   * Retourne une feuille existante ou la crée si absente.
   * Initialise aussi l’en-tête selon le type de feuille.
   */
  getOrCreateSheet(sheetName) {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
      this.initializeSheetHeader(sheet, sheetName);
    }

    if (sheet.getLastRow() === 0) {
      this.initializeSheetHeader(sheet, sheetName);
    }

    return sheet;
  },

  /**
   * Initialise les colonnes d’une feuille selon son objectif.
   */
  initializeSheetHeader(sheet, sheetName) {
    if (sheetName === CONFIG.SHEET_NAME) {
      sheet.appendRow(['Date', 'Nom', 'Prenom', 'TypeCourse', 'Distance', 'Page']);
    } else if (sheetName === CONFIG.LOG_SHEET_NAME) {
      sheet.appendRow(['Date', 'Type', 'Details']);
    }
  }
};

/**
 * Service de logs applicatifs.
 */
const LogService = {
  /**
   * Ajoute un événement dans la feuille Logs.
   * Un échec de log ne doit jamais casser l’API.
   */
  log(type, data) {
    try {
      const sheet = SpreadsheetService.getOrCreateSheet(CONFIG.LOG_SHEET_NAME);
      sheet.appendRow([
        new Date(),
        type,
        JSON.stringify(data || {})
      ]);
    } catch (error) {
      // On ignore volontairement les erreurs de log
    }
  }
};

/**
 * Utilitaires de réponse HTTP JSON.
 */
const ResponseUtils = {
  /**
   * Retourne un objet JSON sérialisé au format attendu
   * par une Web App Apps Script.
   */
  json(obj) {
    return ContentService
      .createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  }
};

/**
 * Utilitaires de lecture de requête.
 */
const RequestUtils = {
  /**
   * Lit un paramètre query string dans un doGet / doPost.
   */
  getParam(e, key) {
    return e && e.parameter ? String(e.parameter[key] || '') : '';
  }
};

/**
 * ============================================================
 * 5) UTILITAIRES BAS NIVEAU
 * ------------------------------------------------------------
 * Fonctions génériques de nettoyage / nombres.
 * ============================================================
 */
const Sanitizer = {
  /**
   * Nettoie une chaîne :
   * - conversion en string
   * - trim
   * - réduction des espaces
   * - limitation de longueur de sécurité
   */
  clean(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .substring(0, 1000);
  },

  /**
   * Version raccourcie pour les logs.
   */
  safeLogString(value) {
    return this.clean(value).substring(0, 120);
  }
};

const NumberUtils = {
  /**
   * Arrondit à 1 décimale.
   */
  round1(value) {
    return Math.round(Number(value || 0) * 10) / 10;
  }
};