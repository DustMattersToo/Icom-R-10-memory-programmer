import type { Channel, Mode } from "./r10-clone";

interface PresetEntry {
  loc: number;
  name: string;
  freq: string;
  mode: Mode;
  comment: string;
}

const CB_40_FREQS: Array<[number, string, string]> = [
  [1, "26.965000", "27MC kanaal 1"],
  [2, "26.975000", "27MC kanaal 2"],
  [3, "26.985000", "27MC kanaal 3"],
  [4, "27.005000", "27MC kanaal 4 (Oproep DE)"],
  [5, "27.015000", "27MC kanaal 5"],
  [6, "27.025000", "27MC kanaal 6"],
  [7, "27.035000", "27MC kanaal 7"],
  [8, "27.055000", "27MC kanaal 8"],
  [9, "27.065000", "27MC kanaal 9 (Nood/Oproep)"],
  [10, "27.075000", "27MC kanaal 10"],
  [11, "27.085000", "27MC kanaal 11"],
  [12, "27.105000", "27MC kanaal 12"],
  [13, "27.115000", "27MC kanaal 13"],
  [14, "27.125000", "27MC kanaal 14 (Oproep NL)"],
  [15, "27.135000", "27MC kanaal 15 (Oproep BE AM)"],
  [16, "27.155000", "27MC kanaal 16 (4x4)"],
  [17, "27.165000", "27MC kanaal 17"],
  [18, "27.175000", "27MC kanaal 18"],
  [19, "27.185000", "27MC kanaal 19 (Truckers)"],
  [20, "27.205000", "27MC kanaal 20"],
  [21, "27.215000", "27MC kanaal 21 (Oproep BE FM)"],
  [22, "27.225000", "27MC kanaal 22 (Campers)"],
  [23, "27.255000", "27MC kanaal 23"],
  [24, "27.235000", "27MC kanaal 24 (Packet)"],
  [25, "27.245000", "27MC kanaal 25"],
  [26, "27.265000", "27MC kanaal 26"],
  [27, "27.275000", "27MC kanaal 27"],
  [28, "27.285000", "27MC kanaal 28"],
  [29, "27.295000", "27MC kanaal 29"],
  [30, "27.305000", "27MC kanaal 30 (SSTV)"],
  [31, "27.315000", "27MC kanaal 31"],
  [32, "27.325000", "27MC kanaal 32"],
  [33, "27.335000", "27MC kanaal 33"],
  [34, "27.345000", "27MC kanaal 34"],
  [35, "27.355000", "27MC kanaal 35"],
  [36, "27.365000", "27MC kanaal 36"],
  [37, "27.375000", "27MC kanaal 37"],
  [38, "27.385000", "27MC kanaal 38 (LSB)"],
  [39, "27.395000", "27MC kanaal 39"],
  [40, "27.405000", "27MC kanaal 40"],
];

const CB_ALPHA_FREQS: Array<[string, string, string]> = [
  ["03A", "26.995000", "27MC Alpha 3A"],
  ["07A", "27.045000", "27MC Alpha 7A"],
  ["11A", "27.095000", "27MC Alpha 11A"],
  ["15A", "27.145000", "27MC Alpha 15A"],
  ["19A", "27.195000", "27MC Alpha 19A"],
];

const BANK_A: PresetEntry[] = [
  ...CB_40_FREQS.map(([ch, freq, comment], idx) => ({
    loc: idx,
    name: `27MC ${ch.toString().padStart(2, "0")}`,
    freq,
    mode: "FM" as Mode,
    comment,
  })),
  ...CB_ALPHA_FREQS.map(([label, freq, comment], idx) => ({
    loc: 40 + idx,
    name: `27MC ${label}`,
    freq,
    mode: "FM" as Mode,
    comment,
  })),
];

// Bank B (50-99): LPD ch 01-50 | Bank C (100-118): LPD ch 51-69 | Bank C (119-134): PMR ch 01-16
const LPD_ENTRIES: PresetEntry[] = Array.from({ length: 69 }, (_, i) => {
  const ch = i + 1;
  const freq = (433.075 + i * 0.025).toFixed(6);
  return {
    loc: 50 + i,
    name: `LPD ${ch.toString().padStart(2, "0")}`,
    freq,
    mode: "FM" as Mode,
    comment: `LPD433 kanaal ${ch}`,
  };
});

const PMR_ENTRIES: PresetEntry[] = Array.from({ length: 16 }, (_, i) => {
  const ch = i + 1;
  const freq = (446.00625 + i * 0.0125).toFixed(6);
  return {
    loc: 119 + i,
    name: `PMR ${ch.toString().padStart(2, "0")}`,
    freq,
    mode: "FM" as Mode,
    comment: `PMR446 kanaal ${ch}`,
  };
});

// Bank D (150-199): Vliegveld Beek / Maastricht Aachen Airport (EHBK) + MUAC
const BANK_D_RAW: Array<[string, string, string]> = [
  ["EHBK TWR", "119.480000", "Beek Tower (8.33 kHz)"],
  ["EHBKTWR2", "119.475000", "Beek Tower (25 kHz)"],
  ["EHBKTWR3", "119.700000", "Beek Tower Alt"],
  ["EHBK APP", "120.205000", "Beek Approach"],
  ["EHBKAPP2", "123.980000", "Beek Approach Backup / Radar"],
  ["EHBK DEL", "121.830000", "Beek Clearance Delivery / Ground"],
  ["EHBKATIS", "124.580000", "Maastricht ATIS (8.33 kHz)"],
  ["EHBKATI2", "124.575000", "Maastricht ATIS (25 kHz)"],
  ["EHBK OPS", "121.900000", "Maastricht Havendienst / Ops"],
  ["EHBK MHS", "131.755000", "Maastricht Handling Services"],
  ["EHBK JET", "131.505000", "Maastricht Jet Center"],
  ["EHBK HND", "131.550000", "Maastricht Ground Handling"],
  ["AIR EMER", "121.500000", "International Air Distress"],
  ["SAR VHF", "123.150000", "SAR Secondary"],
  ["MUAC DL", "135.960000", "Maastricht UAC Delta Low"],
  ["MUAC DM", "135.510000", "Maastricht UAC Delta Mid"],
  ["MUAC DH", "132.085000", "Maastricht UAC Delta High"],
  ["MUAC NCK", "135.980000", "Maastricht UAC Nicky Sector"],
  ["MUAC OLN", "132.855000", "Maastricht UAC Olno Sector"],
  ["MUAC KOK", "132.205000", "Maastricht UAC Koksy Sector"],
];

const BANK_D: PresetEntry[] = BANK_D_RAW.map(([name, freq, comment], idx) => ({
  loc: 150 + idx,
  name,
  freq,
  mode: "AM",
  comment,
}));

// Bank E (200-249): Vliegveld Eindhoven (EHEH)
const BANK_E_RAW: Array<[string, string, string]> = [
  ["EHEH TWR", "131.005000", "Eindhoven Tower (8.33 kHz)"],
  ["EHEHTWR2", "131.000000", "Eindhoven Tower (25 kHz)"],
  ["EHEH SEC", "122.100000", "Eindhoven Tower Backup / Ops"],
  ["EHEH GND", "121.930000", "Eindhoven Ground (8.33 kHz)"],
  ["EHEHGND2", "121.925000", "Eindhoven Ground (25 kHz)"],
  ["EHEHATIS", "126.030000", "Eindhoven ATIS (8.33 kHz)"],
  ["EHEHATI2", "126.025000", "Eindhoven ATIS (25 kHz)"],
  ["EHEH APP", "123.180000", "Eindhoven RAPCON South App (8.33)"],
  ["EHEHAPP2", "123.175000", "Eindhoven RAPCON South App (25)"],
  ["EHEH ARR", "124.530000", "Eindhoven Arrival (8.33 kHz)"],
  ["EHEHARR2", "124.525000", "Eindhoven Arrival (25 kHz)"],
  ["EHEH VFR", "132.530000", "Eindhoven Arrival VFR (8.33)"],
  ["EHEHVFR2", "132.525000", "Eindhoven Arrival VFR (25)"],
  ["334 OPS", "120.650000", "334/336 Sqn Whitehorse Ops VHF"],
  ["336 OPS", "124.400000", "Transport Ops VHF"],
  ["EHEHTWRU", "281.150000", "Eindhoven Tower UHF Primary"],
  ["EHEHTWRB", "257.800000", "Eindhoven Tower UHF Secondary"],
  ["EHEHGNDU", "369.250000", "Eindhoven Ground UHF"],
  ["EHEHARRU", "278.050000", "Eindhoven Arrival UHF"],
  ["RAPCON U", "379.925000", "RAPCON South UHF Primary"],
  ["EHEH DIR", "344.775000", "Eindhoven Director UHF"],
  ["334OPSU", "298.575000", "334 Sqn Whitehorse Ops UHF"],
  ["336OPSU", "261.075000", "336 Sqn Ops UHF"],
  ["MMU TANK", "251.200000", "MMU A330 MRTT Tanker Ops UHF"],
  ["AIR EMER", "121.500000", "International Air Distress VHF"],
  ["UHF EMER", "243.000000", "Military Guard UHF"],
];

const BANK_E: PresetEntry[] = BANK_E_RAW.map(([name, freq, comment], idx) => ({
  loc: 200 + idx,
  name,
  freq,
  mode: "AM",
  comment,
}));

// Bank F (250-299): Militaire frequenties in en rond Limburg
const BANK_F_RAW: Array<[string, string, string]> = [
  ["DMIL INF", "132.350000", "Dutch Mil Flight Info VHF"],
  ["DMIL R1", "128.350000", "Dutch Mil Radar Low-1"],
  ["DMIL R2", "125.930000", "Dutch Mil Radar Low"],
  ["RAPCON S", "123.180000", "RAPCON South Approach VHF"],
  ["DMILUINF", "264.325000", "Dutch Mil Info UHF"],
  ["DMIL CTR", "276.650000", "Dutch Mil Center UHF"],
  ["DMIL RAD", "336.325000", "Dutch Mil Radar UHF"],
  ["RAPCON U", "388.525000", "RAPCON South UHF"],
  ["NATO APP", "362.300000", "NATO Approach UHF"],
  ["NATO DIR", "344.000000", "NATO Director UHF"],
  // Geilenkirchen NATO Air Base (ETNG - AWACS)
  ["ETNG TWR", "120.050000", "Geilenkirchen Tower VHF"],
  ["ETNG PAR", "118.090000", "Geilenkirchen PAR VHF"],
  ["ETNG GCA", "123.725000", "Geilenkirchen GCA VHF"],
  ["ETNG CP", "139.875000", "Geilenkirchen AWACS Command Post"],
  ["ETNGATIS", "142.050000", "Geilenkirchen ATIS VHF"],
  ["ETNGTWRU", "357.375000", "Geilenkirchen Tower UHF"],
  ["ETNG CPU", "259.450000", "Geilenkirchen Command Post UHF"],
  ["ETNGGCAU", "267.400000", "Geilenkirchen GCA UHF"],
  ["ETNGRADU", "377.800000", "Geilenkirchen Radar UHF"],
  ["ETNGATIU", "375.550000", "Geilenkirchen ATIS UHF"],
  // Kleine-Brogel (EBBL - Belgisch Limburg)
  ["EBBL TWR", "122.100000", "Kleine-Brogel NATO Tower VHF"],
  ["EBBL APP", "134.105000", "Kleine-Brogel Approach"],
  ["EBBLAPP2", "134.475000", "Kleine-Brogel Approach 2"],
  ["BAF APP", "122.500000", "Belgian Air Force Common App"],
  ["EBBL FIN", "123.300000", "Kleine-Brogel NATO Final"],
  ["EBBL A/A", "122.650000", "Kleine-Brogel Air-to-Air"],
  ["EBBL OPS", "138.375000", "Kleine-Brogel Wing Ops Whipcream"],
  ["EBBL YEL", "139.800000", "Kleine-Brogel Sqn A/A Yellow"],
  ["EBBL WHT", "140.225000", "Kleine-Brogel Sqn A/A White"],
  ["EBBL RED", "142.925000", "Kleine-Brogel Sqn A/A Red"],
  ["EBBLTWRU", "257.800000", "Kleine-Brogel Tower UHF"],
  ["EBBLFINU", "282.200000", "Kleine-Brogel Final UHF"],
  ["EBBLFIN2", "284.275000", "Kleine-Brogel Final UHF 2"],
  ["EBBLTWR2", "314.375000", "Kleine-Brogel Tower UHF 2"],
  // Volkel (EHVK)
  ["EHVK TWR", "136.075000", "Volkel Tower VHF"],
  ["EHVK FIN", "122.450000", "Volkel Final / ILS"],
  ["EHVKATIS", "126.025000", "Volkel ATIS"],
  ["EHVKTWRU", "291.100000", "Volkel Tower UHF"],
  ["EHVKTWR2", "309.750000", "Volkel Tower UHF 2"],
  ["EHVK 322", "138.900000", "Volkel 322 Sqn F-35 A/A"],
  ["EHVK AA2", "139.175000", "Volkel 322 Sqn A/A 2"],
  ["EHVK AA3", "140.575000", "Volkel 322 Sqn A/A 3"],
  ["EHVK AA4", "140.950000", "Volkel 322 Sqn A/A 4"],
  ["EHVK AA5", "141.675000", "Volkel 322 Sqn A/A 5"],
  ["EHVK A/A", "140.675000", "Volkel General A/A"],
  ["EHVK AA6", "142.075000", "Volkel General A/A 2"],
  // Guard
  ["VHF EMER", "121.500000", "International Air Distress VHF"],
  ["UHF EMER", "243.000000", "Military Guard UHF"],
];

const BANK_F: PresetEntry[] = BANK_F_RAW.map(([name, freq, comment], idx) => ({
  loc: 250 + idx,
  name,
  freq,
  mode: "AM",
  comment,
}));

export const NL_PRESET_ENTRIES: PresetEntry[] = [
  ...BANK_A,
  ...LPD_ENTRIES,
  ...PMR_ENTRIES,
  ...BANK_D,
  ...BANK_E,
  ...BANK_F,
];

export function applyNlPresets(existingRows?: Channel[]): Channel[] {
  const rows: Channel[] = existingRows
    ? existingRows.map((c) =>
        c.loc < 300
          ? { loc: c.loc, name: "", freq: "", mode: "FM", skip: false, comment: "" }
          : c
      )
    : Array.from({ length: 1000 }, (_, loc) => ({
        loc,
        name: "",
        freq: "",
        mode: "FM" as Mode,
        skip: false,
        comment: "",
      }));

  for (const entry of NL_PRESET_ENTRIES) {
    rows[entry.loc] = {
      loc: entry.loc,
      name: entry.name,
      freq: entry.freq,
      mode: entry.mode,
      skip: false,
      comment: entry.comment,
    };
  }
  return rows;
}
