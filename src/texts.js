// -----------------------------------------------------------------------------
// Every text the integration sends to Gladys, in the four languages of the
// Gladys interface: feature names, connection status, errors, the "Test the
// connection" report, scene action and widget messages. German says "du",
// Spanish "usted"; the vocabulary follows the Gladys interface. Brand names
// (Homematic, CCU, RaspberryMatic) are not translated. test/i18n.test.js
// checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './ccu/client.js';

export const LANGUAGE_FALLBACK = 'en';

/** Text of a multi-language object in `language`, English otherwise. */
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** Same object, every language rendered by `render(text, language)`. */
export const each = (text, render) =>
  Object.fromEntries(Object.entries(text).map(([lang, value]) => [lang, render(value, lang)]));

// Feature names, by the `name` of src/homematic/profiles.js (NAME_KEYS) and
// of the CCU device (src/devices.js). Fixed when the user adds the device.
export const NAMES = {
  en: {
    temperature: 'Temperature',
    target: 'Target temperature',
    mode: 'Heating mode',
    heating: 'Heating',
    humidity: 'Humidity',
    window: 'Window (thermostat)',
    contact: 'Opening',
    handle: 'Window handle',
    motion: 'Motion',
    presence: 'Presence',
    illuminance: 'Illuminance',
    smoke: 'Smoke',
    leak: 'Water leak',
    rain: 'Rain',
    wind: 'Wind speed',
    pressure: 'Air pressure',
    battery_low: 'Low battery',
    switch: 'Switch',
    power: 'Power',
    energy: 'Energy',
    voltage: 'Voltage',
    current: 'Current',
    light: 'Light',
    brightness: 'Brightness',
    position: 'Position',
    shutter: 'Shutter',
    service_messages: 'Service messages',
    alarm_messages: 'Alarm messages',
  },
  fr: {
    temperature: 'Température',
    target: 'Consigne',
    mode: 'Mode de chauffage',
    heating: 'Chauffe',
    humidity: 'Humidité',
    window: 'Fenêtre (thermostat)',
    contact: 'Ouverture',
    handle: 'Poignée de fenêtre',
    motion: 'Mouvement',
    presence: 'Présence',
    illuminance: 'Éclairement',
    smoke: 'Fumée',
    leak: "Fuite d'eau",
    rain: 'Pluie',
    wind: 'Vitesse du vent',
    pressure: 'Pression atmosphérique',
    battery_low: 'Batterie faible',
    switch: 'Interrupteur',
    power: 'Puissance',
    energy: 'Énergie',
    voltage: 'Tension',
    current: 'Courant',
    light: 'Lumière',
    brightness: 'Intensité lumineuse',
    position: 'Position',
    shutter: 'Volet',
    service_messages: 'Messages de service',
    alarm_messages: "Messages d'alarme",
  },
  de: {
    temperature: 'Temperatur',
    target: 'Solltemperatur',
    mode: 'Heizmodus',
    heating: 'Heizen',
    humidity: 'Luftfeuchtigkeit',
    window: 'Fenster (Thermostat)',
    contact: 'Öffnung',
    handle: 'Fenstergriff',
    motion: 'Bewegung',
    presence: 'Anwesenheit',
    illuminance: 'Beleuchtungsstärke',
    smoke: 'Rauch',
    leak: 'Wasseraustritt',
    rain: 'Regen',
    wind: 'Windgeschwindigkeit',
    pressure: 'Luftdruck',
    battery_low: 'Batterie schwach',
    switch: 'Schalter',
    power: 'Leistung',
    energy: 'Energie',
    voltage: 'Spannung',
    current: 'Strom',
    light: 'Licht',
    brightness: 'Helligkeit',
    position: 'Position',
    shutter: 'Rollladen',
    service_messages: 'Servicemeldungen',
    alarm_messages: 'Alarmmeldungen',
  },
  es: {
    temperature: 'Temperatura',
    target: 'Temperatura objetivo',
    mode: 'Modo de calefacción',
    heating: 'Calefacción activa',
    humidity: 'Humedad',
    window: 'Ventana (termostato)',
    contact: 'Apertura',
    handle: 'Manilla de ventana',
    motion: 'Movimiento',
    presence: 'Presencia',
    illuminance: 'Iluminancia',
    smoke: 'Humo',
    leak: 'Fuga de agua',
    rain: 'Lluvia',
    wind: 'Velocidad del viento',
    pressure: 'Presión atmosférica',
    battery_low: 'Batería baja',
    switch: 'Interruptor',
    power: 'Potencia',
    energy: 'Energía',
    voltage: 'Tensión',
    current: 'Corriente',
    light: 'Luz',
    brightness: 'Brillo',
    position: 'Posición',
    shutter: 'Persiana',
    service_messages: 'Mensajes de servicio',
    alarm_messages: 'Mensajes de alarma',
  },
};

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noHost: {
    en: 'Enter the address of your CCU in the configuration.',
    fr: "Saisissez l'adresse de votre CCU dans la configuration.",
    de: 'Gib die Adresse deiner CCU in der Konfiguration ein.',
    es: 'Introduzca la dirección de su CCU en la configuración.',
  },
  invalidHost: {
    en: 'CCU address not understood, e.g. 192.168.1.50',
    fr: 'Adresse de la CCU incomprise, ex. 192.168.1.50',
    de: 'CCU-Adresse nicht verstanden, z. B. 192.168.1.50',
    es: 'Dirección de la CCU no válida, p. ej. 192.168.1.50',
  },
};

// One explanation per error kind (src/ccu/client.js), shown as the connection
// status and in the reports.
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'The CCU does not answer: check its address and that it is on.',
    fr: "La CCU ne répond pas : vérifiez son adresse et qu'elle est allumée.",
    de: 'Die CCU antwortet nicht: Prüfe ihre Adresse und ob sie eingeschaltet ist.',
    es: 'La CCU no responde: compruebe su dirección y que esté encendida.',
  },
  [ERROR_KINDS.TLS]: {
    en: 'HTTPS certificate refused: tick "Accept a self-signed certificate".',
    fr: 'Certificat HTTPS refusé : cochez « Accepter un certificat auto-signé ».',
    de: 'HTTPS-Zertifikat abgelehnt: Aktiviere „Selbstsigniertes Zertifikat akzeptieren“.',
    es: 'Certificado HTTPS rechazado: marque «Aceptar un certificado autofirmado».',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'The CCU redirects to HTTPS: enter its address with https://',
    fr: 'La CCU redirige vers le HTTPS : saisissez son adresse avec https://',
    de: 'Die CCU leitet auf HTTPS um: Gib ihre Adresse mit https:// ein.',
    es: 'La CCU redirige a HTTPS: introduzca su dirección con https://',
  },
  [ERROR_KINDS.NOT_CCU]: {
    en: 'No CCU web interface at this address.',
    fr: 'Aucune interface web de CCU à cette adresse.',
    de: 'Keine CCU-Weboberfläche unter dieser Adresse.',
    es: 'No hay ninguna interfaz web de CCU en esta dirección.',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'User or password refused by the CCU (or no free session).',
    fr: 'Utilisateur ou mot de passe refusé par la CCU (ou plus de session libre).',
    de: 'Benutzer oder Passwort von der CCU abgelehnt (oder keine freie Sitzung).',
    es: 'La CCU ha rechazado el usuario o la contraseña (o no queda ninguna sesión libre).',
  },
  [ERROR_KINDS.NOT_ADMIN]: {
    en: 'The CCU user must be an administrator to read the devices.',
    fr: "L'utilisateur de la CCU doit être administrateur pour lire les appareils.",
    de: 'Der CCU-Benutzer muss Administrator sein, um die Geräte zu lesen.',
    es: 'El usuario de la CCU debe ser administrador para leer los dispositivos.',
  },
  [ERROR_KINDS.STARTING]: {
    en: 'The CCU is starting, new try in a moment.',
    fr: 'La CCU démarre, nouvel essai dans un instant.',
    de: 'Die CCU startet, neuer Versuch gleich.',
    es: 'La CCU se está iniciando, nuevo intento en un momento.',
  },
  [ERROR_KINDS.API]: {
    en: 'Unexpected answer from the CCU, see the integration logs.',
    fr: "Réponse inattendue de la CCU, voir les logs de l'intégration.",
    de: 'Unerwartete Antwort der CCU, sieh in den Protokollen der Integration nach.',
    es: 'Respuesta inesperada de la CCU, consulte los registros de la integración.',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: (version) => (version ? `CCU reached (firmware ${version}).` : 'CCU reached.'),
    counts: (devices, programs, sysvars) =>
      `${devices} device(s) for Gladys, ${programs} program(s), ${sysvars} system variable(s).`,
  },
  fr: {
    ok: (version) => (version ? `CCU joignable (firmware ${version}).` : 'CCU joignable.'),
    counts: (devices, programs, sysvars) =>
      `${devices} appareil(s) pour Gladys, ${programs} programme(s), ${sysvars} variable(s) système.`,
  },
  de: {
    ok: (version) => (version ? `CCU erreichbar (Firmware ${version}).` : 'CCU erreichbar.'),
    counts: (devices, programs, sysvars) =>
      `${devices} Gerät(e) für Gladys, ${programs} Programm(e), ${sysvars} Systemvariable(n).`,
  },
  es: {
    ok: (version) => (version ? `CCU accesible (firmware ${version}).` : 'CCU accesible.'),
    counts: (devices, programs, sysvars) =>
      `${devices} dispositivo(s) para Gladys, ${programs} programa(s), ${sysvars} variable(s) del sistema.`,
  },
};

// Errors of the scene actions, widget buttons and device commands.
export const ACTION_TEXT = {
  notConfigured: {
    en: 'The CCU is not configured yet.',
    fr: "La CCU n'est pas encore configurée.",
    de: 'Die CCU ist noch nicht konfiguriert.',
    es: 'La CCU aún no está configurada.',
  },
  noProgram: {
    en: 'Enter the name of a CCU program.',
    fr: "Saisissez le nom d'un programme de la CCU.",
    de: 'Gib den Namen eines CCU-Programms ein.',
    es: 'Introduzca el nombre de un programa de la CCU.',
  },
  programNotFound: {
    en: (name) => `No program named "${name}" on the CCU.`,
    fr: (name) => `Aucun programme nommé « ${name} » sur la CCU.`,
    de: (name) => `Kein Programm namens „${name}“ auf der CCU.`,
    es: (name) => `No hay ningún programa llamado «${name}» en la CCU.`,
  },
  programInactive: {
    en: (name) => `The program "${name}" is disabled on the CCU.`,
    fr: (name) => `Le programme « ${name} » est désactivé sur la CCU.`,
    de: (name) => `Das Programm „${name}“ ist auf der CCU deaktiviert.`,
    es: (name) => `El programa «${name}» está desactivado en la CCU.`,
  },
  programRefused: {
    en: (name) => `The CCU did not run the program "${name}".`,
    fr: (name) => `La CCU n'a pas lancé le programme « ${name} ».`,
    de: (name) => `Die CCU hat das Programm „${name}“ nicht gestartet.`,
    es: (name) => `La CCU no ha ejecutado el programa «${name}».`,
  },
  programStarted: {
    en: (name) => `Program "${name}" started.`,
    fr: (name) => `Programme « ${name} » lancé.`,
    de: (name) => `Programm „${name}“ gestartet.`,
    es: (name) => `Programa «${name}» iniciado.`,
  },
  unknownDevice: {
    en: 'This device is no longer known to the CCU: search the devices again.',
    fr: "Cet appareil n'est plus connu de la CCU : relancez la recherche des appareils.",
    de: 'Dieses Gerät ist der CCU nicht mehr bekannt: Suche erneut nach Geräten.',
    es: 'La CCU ya no conoce este dispositivo: vuelva a buscar los dispositivos.',
  },
  readOnly: {
    en: 'This feature cannot be controlled.',
    fr: 'Cette fonctionnalité ne se pilote pas.',
    de: 'Diese Funktion kann nicht gesteuert werden.',
    es: 'Esta función no se puede controlar.',
  },
};

/** The message of `ACTION_TEXT[key]` in every language, `arg` given to the functions. */
export const actionMessage = (key, arg) =>
  each(ACTION_TEXT[key], (text) => (typeof text === 'function' ? text(arg) : text));
