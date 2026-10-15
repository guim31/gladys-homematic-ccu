// -----------------------------------------------------------------------------
// HomeMatic scripts run on the CCU through the JSON API (`ReGa.runScript`),
// and the parsing of what they write.
//
// Why scripts: the CCU cannot push its changes to this container (its XML-RPC
// callback needs an inbound port, which the Gladys sandbox does not open), so
// the integration reads. One script reads every value it needs in ONE request,
// from the values the CCU logic layer (ReGa) already holds: no radio traffic,
// no duty cycle spent, whatever the number of devices.
//
// FETCH_ALL_SCRIPT is `fetch_all_device_data.fn` of aiohomematic (MIT,
// SukramJ, Daniel Perna), itself derived from `datapoints.fn` of
// ioBroker.hm-rega (MIT, hobbyquaker) — used as published, it lists the
// values of one interface when devices are discovered. READ_SCRIPT is ours,
// written in the same constructs: the values AND timestamps of a given list
// of datapoints and system variables, the timestamps telling a new button
// press from an old one.
// -----------------------------------------------------------------------------

export const FETCH_ALL_SCRIPT = `!# name: fetch_all_device_data.fn
!# param: "##interface##"
!#
!# This script fetches all device data required to initialize the entities without affecting the duty cycle.
!#
!# Original script: https://github.com/ioBroker/ioBroker.hm-rega/blob/master/regascripts/datapoints.fn
!# datapoints.fn 1.9
!# 3'2013-9'2014 hobbyquaker https://github.com/hobbyquaker
!#
!# modified by: SukramJ https://github.com/SukramJ && Baxxy13 https://github.com/Baxxy13
!# v2.5 - 06/2026
!#
!# Das Interface wird durch die Integration an 'sUse_Interface' übergeben.
!# Nutzbare Interfaces: BidCos-RF, BidCos-Wired, HmIP-RF, VirtualDevices, CUxD, CCU-Jack

string sUse_Interface = "##interface##";
string sDevId; string sChnId; string sDPId; string sAllDevices; string sDP_Namestring;
object oDevice; object oChannel; object oDP;
integer iInterface_ID; integer iDP_Value_Type; integer iDP_Value_VarType;
idarray iChnDPs_Array;
var vDP_Value;
boolean bDPFirst = true; boolean bDPisValid;
object oInterface = interfaces.Get(sUse_Interface);

Write('{');
if (oInterface) {
  iInterface_ID = interfaces.Get(sUse_Interface).ID();
  sAllDevices = dom.GetObject(ID_DEVICES).EnumUsedIDs();
  foreach (sDevId, sAllDevices) {
    oDevice = dom.GetObject(sDevId);
    if ((oDevice) && (oDevice.ReadyConfig()) && (oDevice.Interface() == iInterface_ID)) {
      foreach (sChnId, oDevice.Channels()) {
        oChannel = dom.GetObject(sChnId);
        if (oChannel) {
          iChnDPs_Array = oChannel.DPs();
          if (iChnDPs_Array) {
            foreach(sDPId, iChnDPs_Array) {
              oDP = dom.GetObject(sDPId);
              bDPisValid = false;
              if (oDP && oDP.Timestamp()) {
                !# DP muss validen Timestamp() haben
                bDPisValid = true;
                if ((!oDP.LastTimestamp()) && (sUse_Interface == "VirtualDevices")) {
                  !# Sonderbehandlung VirtualDevices, DP muss validen LastTimestamp() haben
                  bDPisValid = false;
                }
              }
              if (bDPisValid) {
                if (oDP.TypeName() != "VARDP") {
                  !# keine Systemvariablen
                  iDP_Value_Type = oDP.ValueType();
                  vDP_Value = "";
                  sDP_Namestring = oDP.Name().UriEncode();
                  if (iDP_Value_Type == 20) {
                    !# String-Datenpunkte
                    vDP_Value = '"'# oDP.Value().UriEncode() #'"';
                  }
                  else {
                    !# alle Datenpunkte außer String
                    iDP_Value_VarType = 20;
                    vDP_Value = oDP.Value();
                    iDP_Value_VarType = vDP_Value.VarType();
                    if (iDP_Value_Type == 2) {
                      !# Boolean-Datenpunkte
                      if (vDP_Value) {
                        vDP_Value = "true";
                      }
                      else {
                        vDP_Value = "false";
                      }
                    }
                    if ((iDP_Value_VarType == 4) && (vDP_Value == "")) {
                      !# Sonderpruefung auf String Scriptvariable und Leerstring
                      vDP_Value = 0;
                    }
                  }
                  if (bDPFirst) {
                    bDPFirst = false;
                  }
                  else {
                    WriteLine(',');
                  }
                  !# altes Verhalten: setze 0.00000 auf 0
                  if (vDP_Value == "") { vDP_Value = 0; }
                  Write('"');
                  Write(sDP_Namestring);
                  Write('":');
                  Write(vDP_Value);
                }
              }
            }
          }
        }
      }
    }
  }
}
Write('}');
`;

// Writes {"dp":{"<name>":[value,timestamp],...},"sv":{"<id>":[value,timestamp],...}}.
// A datapoint or a variable that does not exist, or never received a value,
// is left out. Timestamps are whole seconds; only their changes are used.
export const READ_SCRIPT = `!# name: gladys_read_datapoints
string sNames = "##names##";
string sVars = "##sysvars##";
string sName; object oDP; var vValue; integer iType; boolean bFirst = true;
Write('{"dp":{');
foreach (sName, sNames) {
  oDP = dom.GetObject(sName);
  if (oDP) {
    if (oDP.Timestamp()) {
      if (bFirst) { bFirst = false; } else { Write(','); }
      Write('"' # sName # '":[');
      iType = oDP.ValueType();
      if (iType == 20) {
        Write('"' # oDP.Value().UriEncode() # '"');
      } else {
        vValue = oDP.Value();
        if (iType == 2) {
          if (vValue) { Write('true'); } else { Write('false'); }
        } else {
          if (vValue == "") { vValue = 0; }
          Write(vValue);
        }
      }
      Write(',' # oDP.Timestamp().ToInteger() # ']');
    }
  }
}
Write('},"sv":{');
bFirst = true;
foreach (sName, sVars) {
  oDP = dom.GetObject(sName.ToInteger());
  if (oDP) {
    if (bFirst) { bFirst = false; } else { Write(','); }
    Write('"' # sName # '":[');
    iType = oDP.ValueType();
    if (iType == 20) {
      Write('"' # oDP.Value().UriEncode() # '"');
    } else {
      vValue = oDP.Value();
      if (iType == 2) {
        if (vValue) { Write('true'); } else { Write('false'); }
      } else {
        if (vValue == "") { vValue = 0; }
        Write(vValue);
      }
    }
    Write(',' # oDP.Timestamp().ToInteger() # ']');
  }
}
Write('}}');
`;

// What may go inside the double quotes of a script: interface names, device
// addresses and parameter names only (`HmIP-RF.0001D3C99C3C93:1.STATE`).
// Nothing else is ever interpolated: no script injection through a name.
const SAFE_NAME = /^[A-Za-z0-9_.:-]+$/;
const SAFE_ID = /^\d+$/;

export function fetchAllScript(iface) {
  if (!SAFE_NAME.test(iface)) {
    throw new Error(`Invalid interface name ${JSON.stringify(iface)}`);
  }
  return FETCH_ALL_SCRIPT.replaceAll('##interface##', iface);
}

/**
 * @param {string[]} names datapoint names, `<interface>.<address>:<channel>.<parameter>`
 * @param {string[]} sysvarIds ReGa ids of system variables
 */
export function readScript(names, sysvarIds) {
  for (const name of names) {
    if (!SAFE_NAME.test(name)) {
      throw new Error(`Invalid datapoint name ${JSON.stringify(name)}`);
    }
  }
  for (const id of sysvarIds) {
    if (!SAFE_ID.test(id)) {
      throw new Error(`Invalid variable id ${JSON.stringify(id)}`);
    }
  }
  // ReGa `foreach` walks a string split on tabs.
  return READ_SCRIPT.replace('##names##', names.join('\t')).replace(
    '##sysvars##',
    sysvarIds.join('\t'),
  );
}

/**
 * Decode a ReGa `UriEncode()` string. ReGa encodes the bytes of its strings,
 * UTF-8 on the 3.x firmwares, ISO-8859-1 on the older ones: decode as UTF-8,
 * fall back to Latin-1 (what aiohomematic does) when the bytes are not UTF-8.
 */
export function uriDecode(text) {
  if (typeof text !== 'string' || !text.includes('%')) {
    return text;
  }
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '%' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = text.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else {
        bytes.push(...Buffer.from(text[i], 'utf8'));
      }
    }
  }
  const buffer = Uint8Array.from(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('latin1').decode(buffer);
  }
}

/**
 * Escape the raw control characters found INSIDE the strings of a JSON text
 * (the CCU may leave a tab or a line break in a name), keeping the ones
 * between values, like aiohomematic does.
 */
export function escapeControlCharacters(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      } else if (char.charCodeAt(0) < 0x20) {
        out += `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
        continue;
      }
    } else if (char === '"') {
      inString = true;
    }
    out += char;
  }
  return out;
}

/**
 * Parse the JSON a script wrote.
 * @param {string} output
 */
export function parseScriptOutput(output) {
  if (typeof output !== 'string' || output.trim() === '') {
    throw new Error('The script wrote nothing');
  }
  try {
    return JSON.parse(output);
  } catch {
    return JSON.parse(escapeControlCharacters(output));
  }
}

/** `fetch_all_device_data` output → Map of datapoint name → value. */
export function parseFetchAll(output) {
  const raw = parseScriptOutput(output);
  const values = new Map();
  for (const [name, value] of Object.entries(raw ?? {})) {
    values.set(uriDecode(name), typeof value === 'string' ? uriDecode(value) : value);
  }
  return values;
}

/** READ_SCRIPT output → { datapoints, sysvars }, Maps of name/id → { value, ts }. */
export function parseRead(output) {
  const raw = parseScriptOutput(output);
  const read = (object) => {
    const map = new Map();
    for (const [key, entry] of Object.entries(object ?? {})) {
      if (!Array.isArray(entry)) {
        continue;
      }
      const [value, ts] = entry;
      map.set(key, {
        value: typeof value === 'string' ? uriDecode(value) : value,
        ts: Number.isFinite(ts) ? ts : 0,
      });
    }
    return map;
  };
  return { datapoints: read(raw?.dp), sysvars: read(raw?.sv) };
}
