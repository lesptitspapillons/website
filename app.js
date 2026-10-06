(() => {
  'use strict';

  /**
   * ============================================================
   * 1) CONFIGURATION GÉNÉRALE
   * ------------------------------------------------------------
   * Centralise tous les paramètres "métier" et techniques.
   * Modifie ici les valeurs globales du comportement applicatif.
   * ============================================================
   */
  const CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbzSGZamk0aMLRsUM0J5BuHLj63c26HrqtXT1q21jNrmQRkhN3cZuZP1rhoTTjIa9lhm/exec',
    DEFAULT_OBJECTIF_KM: 2000,
    REQUEST_TIMEOUT_MS: 10000,
    MIN_FORM_OPEN_MS: 2500,
    MIN_DISTANCE_KM: 0.1,
    MAX_DISTANCE_KM: 100,
    ALLOWED_RACE_TYPES: ['Course', 'Marche', 'Vélo', 'Relais', 'Autre']
  };

  /**
   * ============================================================
   * 2) ÉTAT GLOBAL DE L’APPLICATION
   * ------------------------------------------------------------
   * Cet objet contient uniquement l’état dynamique de la page.
   * On évite les variables globales éparpillées.
   * ============================================================
   */
  const state = {
    isSubmitting: false,
    formOpenedAt: null
  };

  /**
   * ============================================================
   * 3) RÉFÉRENCES DOM
   * ------------------------------------------------------------
   * Toutes les références aux éléments HTML sont centralisées ici.
   * Cela rend le code plus lisible et évite de multiplier
   * les document.getElementById partout.
   * ============================================================
   */
  const DOM = {
    // Navigation
    brandLink: document.getElementById('brand-link'),
    navButtons: document.querySelectorAll('.nav-btn'),
    joinBtn: document.getElementById('join-btn'),
    heroJoinBtn: document.getElementById('hero-join-btn'),
    panelJoinBtn: document.getElementById('panel-join-btn'),

    // Panels
    panels: document.querySelectorAll('.panel'),
    menuButtons: document.querySelectorAll('.menu button'),

    // Modale
    modalOverlay: document.getElementById('modal-overlay'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    modalFormView: document.getElementById('modal-form-view'),
    modalSuccessView: document.getElementById('modal-success-view'),

    // Formulaire
    form: document.getElementById('participation-form'),
    submitBtn: document.getElementById('submit-btn'),
    formStatus: document.getElementById('form-status'),
    inputNom: document.getElementById('nom'),
    inputPrenom: document.getElementById('prenom'),
    inputTypeCourse: document.getElementById('typeCourse'),
    inputDistance: document.getElementById('distance'),
    inputWebsite: document.getElementById('website'),

    // Statistiques
    statParticipants: document.getElementById('stat-participants'),
    statKm: document.getElementById('stat-km'),
    statObjectif: document.getElementById('stat-objectif'),
    progressBar: document.getElementById('progress-bar'),
    progressText: document.getElementById('progress-text')
  };

  /**
   * ============================================================
   * 4) UTILITAIRES GÉNÉRAUX
   * ------------------------------------------------------------
   * Fonctions transverses réutilisables partout dans l’application.
   * ============================================================
   */
  const Utils = {
    /**
     * Nettoie une chaîne de caractères :
     * - convertit en string
     * - trim
     * - remplace les espaces multiples par un seul espace
     */
    sanitizeText(value) {
      return String(value || '').trim().replace(/\s+/g, ' ');
    },

    /**
     * Formate un nombre selon les conventions françaises.
     * Exemple : 1234.5 => "1 234,5"
     */
    formatNumberFR(value) {
      return new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: Number(value) % 1 !== 0 ? 1 : 0,
        maximumFractionDigits: 1
      }).format(Number(value || 0));
    },

    /**
     * Fait défiler la page vers le haut en douceur.
     */
    scrollToTop() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /**
     * Wrapper fetch avec timeout.
     * Permet d’éviter qu’une requête reste bloquée indéfiniment.
     */
    async fetchWithTimeout(url, options = {}) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    }
  };

  /**
   * ============================================================
   * 5) GESTION DE LA NAVIGATION / DES PANELS
   * ------------------------------------------------------------
   * Tout ce qui concerne :
   * - retour accueil
   * - changement d’onglet / section
   * - classes actives de navigation
   * ============================================================
   */
  const Navigation = {
    /**
     * Désactive toutes les sections et retire les états actifs
     * du menu.
     */
    resetPanelsAndMenu() {
      DOM.panels.forEach(panel => panel.classList.remove('active'));
      DOM.menuButtons.forEach(button => button.classList.remove('active'));
    },

    /**
     * Retourne à l’accueil :
     * - masque tous les panneaux
     * - retire les états actifs
     * - remonte en haut de page
     */
    goHome(event) {
      if (event) event.preventDefault();
      this.resetPanelsAndMenu();
      Utils.scrollToTop();
    },

    /**
     * Affiche un panneau de contenu à partir de son id
     * et active le bouton correspondant dans le menu.
     */
    showPanel(panelId) {
      this.resetPanelsAndMenu();

      const panel = document.getElementById(panelId);
      const relatedButton = document.querySelector(`.menu button[data-panel="${panelId}"]`);

      if (panel) {
        panel.classList.add('active');
      }

      if (relatedButton) {
        relatedButton.classList.add('active');
      }

      Utils.scrollToTop();
    }
  };

  /**
   * ============================================================
   * 6) GESTION DE LA MODALE
   * ------------------------------------------------------------
   * Tout ce qui concerne l’ouverture / fermeture de la modale,
   * et l’affichage des vues internes (formulaire / succès).
   * ============================================================
   */
  const Modal = {
    /**
     * Ouvre la modale et mémorise l’instant d’ouverture
     * pour l’anti-spam "soumission trop rapide".
     */
    open() {
      state.formOpenedAt = Date.now();
      FormUI.resetStatus();
      DOM.modalOverlay.classList.add('open');
      DOM.modalOverlay.setAttribute('aria-hidden', 'false');
    },

    /**
     * Ferme la modale si aucune soumission n’est en cours.
     */
    close() {
      if (state.isSubmitting) return;

      DOM.modalOverlay.classList.remove('open');
      DOM.modalOverlay.setAttribute('aria-hidden', 'true');
    },

    /**
     * Affiche la vue succès et masque la vue formulaire.
     */
    showSuccessView() {
      DOM.modalFormView.hidden = true;
      DOM.modalSuccessView.hidden = false;
    },

    /**
     * Affiche la vue formulaire et masque la vue succès.
     * Utile pour réinitialiser la modale après un envoi.
     */
    showFormView() {
      DOM.modalSuccessView.hidden = true;
      DOM.modalFormView.hidden = false;
    }
  };

  /**
   * ============================================================
   * 7) GESTION VISUELLE DU FORMULAIRE
   * ------------------------------------------------------------
   * Tout ce qui concerne l’UI du formulaire :
   * - messages
   * - verrouillage bouton
   * - reset visuel
   * ============================================================
   */
  const FormUI = {
    /**
     * Vide le message de statut.
     */
    resetStatus() {
      DOM.formStatus.textContent = '';
      DOM.formStatus.className = 'form-status';
    },

    /**
     * Affiche un message sous le formulaire.
     * type possible : "info", "success", "error"
     */
    setStatus(message, type = 'info') {
      DOM.formStatus.textContent = message;
      DOM.formStatus.className = `form-status ${type}`;
    },

    /**
     * Verrouille le formulaire pendant l’envoi.
     */
    lock() {
      state.isSubmitting = true;
      DOM.submitBtn.disabled = true;
    },

    /**
     * Déverrouille le formulaire après l’envoi.
     */
    unlock() {
      state.isSubmitting = false;
      DOM.submitBtn.disabled = false;
    },

    /**
     * Réinitialise les champs du formulaire HTML.
     */
    resetForm() {
      DOM.form.reset();
    }
  };

  /**
   * ============================================================
   * 8) GESTION DES DONNÉES DU FORMULAIRE
   * ------------------------------------------------------------
   * Ce bloc s’occupe de :
   * - lire les champs
   * - construire le payload
   * - valider le contenu côté front
   * ============================================================
   */
  const FormDataManager = {
    /**
     * Lit les champs du formulaire et construit l’objet
     * qui sera envoyé à Apps Script.
     */
    buildPayload() {
      return {
        nom: Utils.sanitizeText(DOM.inputNom.value),
        prenom: Utils.sanitizeText(DOM.inputPrenom.value),
        typeCourse: Utils.sanitizeText(DOM.inputTypeCourse.value),
        distance: parseFloat(DOM.inputDistance.value),
        website: Utils.sanitizeText(DOM.inputWebsite.value), // Honeypot
        formOpenedAt: state.formOpenedAt || Date.now(),
        submittedAt: Date.now(),
        page: window.location.href
      };
    },

    /**
     * Valide le payload côté client.
     * Retourne :
     * - null si tout est valide
     * - un message d’erreur sinon
     */
    validate(payload) {
      if (!payload.nom || !payload.prenom || !payload.typeCourse) {
        return 'Merci de remplir tous les champs.';
      }

      if (payload.nom.length < 2 || payload.prenom.length < 2) {
        return 'Le nom et le prénom doivent contenir au moins 2 caractères.';
      }

      if (!CONFIG.ALLOWED_RACE_TYPES.includes(payload.typeCourse)) {
        return 'Type de course invalide.';
      }

      if (Number.isNaN(payload.distance)) {
        return 'Merci d’indiquer une distance valide.';
      }

      if (
        payload.distance < CONFIG.MIN_DISTANCE_KM ||
        payload.distance > CONFIG.MAX_DISTANCE_KM
      ) {
        return `La distance doit être comprise entre ${CONFIG.MIN_DISTANCE_KM} et ${CONFIG.MAX_DISTANCE_KM} km.`;
      }

      if ((payload.submittedAt - payload.formOpenedAt) < CONFIG.MIN_FORM_OPEN_MS) {
        return 'Soumission trop rapide. Merci de relire votre formulaire.';
      }

      return null;
    }
  };

  /**
   * ============================================================
   * 9) COMMUNICATION AVEC APPS SCRIPT
   * ------------------------------------------------------------
   * Ce bloc regroupe toutes les fonctions liées à l’API distante :
   * - récupérer les stats
   * - envoyer une inscription
   *
   * L’idée : toute la logique réseau est regroupée au même endroit.
   * ============================================================
   */
  const AppsScriptAPI = {
    /**
     * Récupère les statistiques agrégées depuis Apps Script.
     * Retour attendu :
     * {
     *   success: true,
     *   participants: number,
     *   totalDistance: number,
     *   objectif: number
     * }
     */
    async fetchStats() {
      const response = await Utils.fetchWithTimeout(`${CONFIG.API_URL}?action=stats`, {
        method: 'GET'
      });

      return response.json();
    },

    /**
     * Envoie une inscription à Apps Script.
     * Le payload est envoyé en JSON brut dans le body.
     */
    async submitRegistration(payload) {
      const response = await Utils.fetchWithTimeout(CONFIG.API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload)
      });

      return response.json();
    }
  };

  /**
   * ============================================================
   * 10) GESTION DES STATISTIQUES
   * ------------------------------------------------------------
   * Ce bloc se charge de :
   * - traduire les données API en affichage visuel
   * - mettre à jour compteurs + barre de progression
   * ============================================================
   */
  const Stats = {
    /**
     * Met à jour la barre de progression en fonction
     * de la distance totale parcourue et de l’objectif.
     */
    updateProgressBar(totalDistance, objectifKm) {
      const safeObjectif = Number(objectifKm || CONFIG.DEFAULT_OBJECTIF_KM);
      const safeDistance = Number(totalDistance || 0);

      const percent = safeObjectif > 0
        ? Math.min((safeDistance / safeObjectif) * 100, 100)
        : 0;

      DOM.progressBar.style.width = `${percent}%`;
      DOM.progressText.textContent = `${percent.toFixed(1).replace('.', ',')}% atteint`;
    },

    /**
     * Met à jour les 3 blocs statistiques visibles dans la page.
     */
    render(data) {
      const participants = Number(data.participants || 0);
      const totalDistance = Number(data.totalDistance || 0);
      const objectif = Number(data.objectif || CONFIG.DEFAULT_OBJECTIF_KM);

      DOM.statParticipants.textContent = Utils.formatNumberFR(participants);
      DOM.statKm.textContent = Utils.formatNumberFR(totalDistance);
      DOM.statObjectif.textContent = Utils.formatNumberFR(objectif);

      this.updateProgressBar(totalDistance, objectif);
    },

    /**
     * Charge les statistiques depuis Apps Script puis les affiche.
     * En cas d’erreur, on logge simplement dans la console.
     */
    async loadAndRender() {
      try {
        const data = await AppsScriptAPI.fetchStats();

        if (!data.success) {
          console.warn('Réponse stats non valide', data);
          return;
        }

        this.render(data);
      } catch (error) {
        console.error('Erreur lors du chargement des statistiques', error);
      }
    }
  };

  /**
   * ============================================================
   * 11) ORCHESTRATION DE LA SOUMISSION DU FORMULAIRE
   * ------------------------------------------------------------
   * Ce bloc contient la logique métier de soumission :
   * - lecture formulaire
   * - validation front
   * - appel Apps Script
   * - gestion succès / erreur
   * ============================================================
   */
  const RegistrationController = {
    /**
     * Traite l’envoi complet du formulaire.
     */
    async handleSubmit(event) {
      event.preventDefault();

      if (state.isSubmitting) return;

      FormUI.resetStatus();

      const payload = FormDataManager.buildPayload();
      const validationError = FormDataManager.validate(payload);

      if (validationError) {
        FormUI.setStatus(validationError, 'error');
        return;
      }

      FormUI.lock();
      FormUI.setStatus('Envoi en cours...', 'info');

      try {
        const result = await AppsScriptAPI.submitRegistration(payload);

        if (!result.success) {
          FormUI.setStatus(
            result.message || 'Une erreur est survenue lors de l’enregistrement.',
            'error'
          );
          FormUI.unlock();
          return;
        }

        // Succès d’inscription
        FormUI.resetForm();
        FormUI.resetStatus();
        Modal.showSuccessView();

        // On recharge les stats immédiatement après ajout
        await Stats.loadAndRender();

        // Puis on ferme la modale et on remet l’UI dans son état initial
        setTimeout(() => {
          Modal.showFormView();
          Modal.close();
          FormUI.unlock();
          Navigation.goHome();
        }, 1800);

      } catch (error) {
        console.error('Erreur lors de la soumission du formulaire', error);

        if (error.name === 'AbortError') {
          FormUI.setStatus(
            'Le serveur met trop de temps à répondre. Réessaie dans un instant.',
            'error'
          );
        } else {
          FormUI.setStatus(
            'Impossible d’envoyer le formulaire. Réessaie dans un instant.',
            'error'
          );
        }

        FormUI.unlock();
      }
    }
  };

  /**
   * ============================================================
   * 12) BINDING DES ÉVÉNEMENTS
   * ------------------------------------------------------------
   * Tous les addEventListener sont regroupés ici.
   * Cela évite de les disperser dans toute l’application.
   * ============================================================
   */
  const EventBinder = {
    /**
     * Lie tous les événements UI de la page.
     */
    bindAll() {
      // Retour accueil
      DOM.brandLink.addEventListener('click', (event) => Navigation.goHome(event));

      // Boutons de navigation des sections
      DOM.navButtons.forEach(button => {
        button.addEventListener('click', () => {
          const panelId = button.dataset.panel;
          Navigation.showPanel(panelId);
        });
      });

      // Boutons ouvrant la modale
      [DOM.joinBtn, DOM.heroJoinBtn, DOM.panelJoinBtn].forEach(button => {
        if (button) {
          button.addEventListener('click', () => Modal.open());
        }
      });

      // Fermeture modale via bouton
      DOM.modalCloseBtn.addEventListener('click', () => Modal.close());

      // Fermeture modale si clic sur overlay
      DOM.modalOverlay.addEventListener('click', (event) => {
        if (event.target === DOM.modalOverlay) {
          Modal.close();
        }
      });

      // Fermeture modale avec la touche Escape
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          Modal.close();
        }
      });

      // Soumission formulaire
      DOM.form.addEventListener('submit', (event) =>
        RegistrationController.handleSubmit(event)
      );
    }
  };

  /**
   * ============================================================
   * 13) INITIALISATION DE L’APPLICATION
   * ------------------------------------------------------------
   * Point d’entrée unique.
   * On initialise les bindings puis on charge les stats.
   * ============================================================
   */
  const App = {
    /**
     * Initialise l’application front.
     */
    async init() {
      EventBinder.bindAll();
      await Stats.loadAndRender();
    }
  };

  // Lancement de l’application
  App.init();
})();