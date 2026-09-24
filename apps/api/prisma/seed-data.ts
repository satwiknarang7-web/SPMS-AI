/**
 * Demo catalogue. Brand names are used as ordinary product descriptions for realism; prices,
 * PBS codes and DPMQs are illustrative only and must not be relied on.
 */

export interface DrugSeed {
  generic: string;
  ingredient: string;
  strength: string;
  form: string;
  pack: number;
  cls: string;
  schedule: string;
  pbs: string | null;
  dpmq: number | null;
  maxQty: number;
  maxRepeats: number;
  minRepeatDays: number;
  weight: number; // relative dispensing frequency
  brands: [brand: string, cost: number, premium?: number][];
}

export const DRUGS: DrugSeed[] = [
  { generic: 'Atorvastatin', ingredient: 'atorvastatin', strength: '40 mg', form: 'Tablet', pack: 30, cls: 'Statin', schedule: 'S4', pbs: '8215K', dpmq: 1795, maxQty: 30, maxRepeats: 5, minRepeatDays: 20, weight: 10, brands: [['Lipitor', 1450], ['APO-Atorvastatin', 640], ['Atorvastatin Sandoz', 610]] },
  { generic: 'Rosuvastatin', ingredient: 'rosuvastatin', strength: '10 mg', form: 'Tablet', pack: 30, cls: 'Statin', schedule: 'S4', pbs: '8839T', dpmq: 1620, maxQty: 30, maxRepeats: 5, minRepeatDays: 20, weight: 9, brands: [['Crestor', 1380, 250], ['Rosuvastatin GH', 520], ['APO-Rosuvastatin', 540]] },
  { generic: 'Metformin', ingredient: 'metformin', strength: '500 mg', form: 'Tablet', pack: 100, cls: 'Biguanide', schedule: 'S4', pbs: '2430Q', dpmq: 1310, maxQty: 100, maxRepeats: 5, minRepeatDays: 20, weight: 8, brands: [['Diabex', 780], ['Metformin Sandoz', 420]] },
  { generic: 'Amoxicillin', ingredient: 'amoxicillin', strength: '500 mg', form: 'Capsule', pack: 20, cls: 'Penicillin', schedule: 'S4', pbs: '1889B', dpmq: 1290, maxQty: 20, maxRepeats: 0, minRepeatDays: 0, weight: 7, brands: [['Amoxil', 820], ['Alphamox', 440]] },
  { generic: 'Amoxicillin + Clavulanic acid', ingredient: 'amoxicillin', strength: '875/125 mg', form: 'Tablet', pack: 10, cls: 'Penicillin', schedule: 'S4', pbs: '8254L', dpmq: 1650, maxQty: 10, maxRepeats: 1, minRepeatDays: 0, weight: 5, brands: [['Augmentin Duo Forte', 1080], ['Clamoxyl Duo Forte', 650]] },
  { generic: 'Cefalexin', ingredient: 'cefalexin', strength: '500 mg', form: 'Capsule', pack: 20, cls: 'Cephalosporin', schedule: 'S4', pbs: '1147N', dpmq: 1380, maxQty: 20, maxRepeats: 1, minRepeatDays: 0, weight: 5, brands: [['Keflex', 760], ['Ialex', 430]] },
  { generic: 'Perindopril', ingredient: 'perindopril', strength: '5 mg', form: 'Tablet', pack: 30, cls: 'ACE inhibitor', schedule: 'S4', pbs: '8550G', dpmq: 1580, maxQty: 30, maxRepeats: 5, minRepeatDays: 20, weight: 7, brands: [['Coversyl', 1120], ['APO-Perindopril', 480]] },
  { generic: 'Amlodipine', ingredient: 'amlodipine', strength: '5 mg', form: 'Tablet', pack: 30, cls: 'Calcium channel blocker', schedule: 'S4', pbs: '2750N', dpmq: 1190, maxQty: 30, maxRepeats: 5, minRepeatDays: 20, weight: 7, brands: [['Norvasc', 820], ['Amlodipine Sandoz', 350]] },
  { generic: 'Esomeprazole', ingredient: 'esomeprazole', strength: '20 mg', form: 'Tablet', pack: 30, cls: 'Proton pump inhibitor', schedule: 'S4', pbs: '8331Y', dpmq: 1850, maxQty: 30, maxRepeats: 5, minRepeatDays: 20, weight: 8, brands: [['Nexium', 1350], ['Esomeprazole Sandoz', 560]] },
  { generic: 'Pantoprazole', ingredient: 'pantoprazole', strength: '40 mg', form: 'Tablet', pack: 30, cls: 'Proton pump inhibitor', schedule: 'S4', pbs: '8008J', dpmq: 1520, maxQty: 30, maxRepeats: 5, minRepeatDays: 20, weight: 6, brands: [['Somac', 1100], ['Pantoprazole GH', 430]] },
  { generic: 'Sertraline', ingredient: 'sertraline', strength: '50 mg', form: 'Tablet', pack: 30, cls: 'SSRI', schedule: 'S4', pbs: '2236J', dpmq: 1450, maxQty: 30, maxRepeats: 5, minRepeatDays: 20, weight: 6, brands: [['Zoloft', 1050], ['Sertraline Sandoz', 420]] },
  { generic: 'Escitalopram', ingredient: 'escitalopram', strength: '10 mg', form: 'Tablet', pack: 28, cls: 'SSRI', schedule: 'S4', pbs: '8703N', dpmq: 1540, maxQty: 28, maxRepeats: 5, minRepeatDays: 20, weight: 5, brands: [['Lexapro', 1190], ['Esipram', 430]] },
  { generic: 'Salbutamol', ingredient: 'salbutamol', strength: '100 mcg/dose', form: 'Inhaler', pack: 1, cls: 'Beta-2 agonist', schedule: 'S3', pbs: '8354E', dpmq: 1085, maxQty: 2, maxRepeats: 5, minRepeatDays: 0, weight: 6, brands: [['Ventolin', 780], ['Asmol', 560]] },
  { generic: 'Fluticasone + Salmeterol', ingredient: 'salmeterol', strength: '250/25 mcg', form: 'Inhaler', pack: 1, cls: 'ICS/LABA', schedule: 'S4', pbs: '8519N', dpmq: 5420, maxQty: 1, maxRepeats: 5, minRepeatDays: 20, weight: 4, brands: [['Seretide MDI', 4200], ['Salflumix', 2950]] },
  { generic: 'Warfarin', ingredient: 'warfarin', strength: '5 mg', form: 'Tablet', pack: 50, cls: 'Anticoagulant', schedule: 'S4', pbs: '2211D', dpmq: 1390, maxQty: 50, maxRepeats: 5, minRepeatDays: 20, weight: 3, brands: [['Coumadin', 980], ['Marevan', 910]] },
  { generic: 'Aspirin', ingredient: 'aspirin', strength: '100 mg', form: 'Tablet (EC)', pack: 112, cls: 'Antiplatelet', schedule: 'S2', pbs: '8166C', dpmq: 890, maxQty: 112, maxRepeats: 5, minRepeatDays: 20, weight: 4, brands: [['Cartia', 520], ['Astrix', 480]] },
  { generic: 'Clopidogrel', ingredient: 'clopidogrel', strength: '75 mg', form: 'Tablet', pack: 28, cls: 'Antiplatelet', schedule: 'S4', pbs: '8358J', dpmq: 1420, maxQty: 28, maxRepeats: 5, minRepeatDays: 20, weight: 4, brands: [['Plavix', 1080], ['Clopidogrel Sandoz', 390]] },
  { generic: 'Apixaban', ingredient: 'apixaban', strength: '5 mg', form: 'Tablet', pack: 60, cls: 'Anticoagulant', schedule: 'S4', pbs: '10227B', dpmq: 9890, maxQty: 60, maxRepeats: 5, minRepeatDays: 20, weight: 4, brands: [['Eliquis', 8450]] },
  { generic: 'Oxycodone', ingredient: 'oxycodone', strength: '5 mg', form: 'Tablet', pack: 20, cls: 'Opioid', schedule: 'S8', pbs: '2622W', dpmq: 1310, maxQty: 20, maxRepeats: 0, minRepeatDays: 0, weight: 2, brands: [['Endone', 720]] },
  { generic: 'Paracetamol + Codeine', ingredient: 'codeine', strength: '500/30 mg', form: 'Tablet', pack: 20, cls: 'Opioid', schedule: 'S4', pbs: '1215E', dpmq: 1150, maxQty: 20, maxRepeats: 0, minRepeatDays: 0, weight: 3, brands: [['Panadeine Forte', 690], ['Codapane Forte', 420]] },
  { generic: 'Tramadol', ingredient: 'tramadol', strength: '50 mg', form: 'Capsule', pack: 20, cls: 'Opioid', schedule: 'S4', pbs: '8455G', dpmq: 1220, maxQty: 20, maxRepeats: 0, minRepeatDays: 0, weight: 2, brands: [['Tramal', 720], ['Tramadol Sandoz', 380]] },
  { generic: 'Prednisolone', ingredient: 'prednisolone', strength: '25 mg', form: 'Tablet', pack: 30, cls: 'Corticosteroid', schedule: 'S4', pbs: '1916K', dpmq: 1080, maxQty: 30, maxRepeats: 1, minRepeatDays: 0, weight: 3, brands: [['Panafcortelone', 520], ['Solone', 480]] },
  { generic: 'Levothyroxine', ingredient: 'levothyroxine', strength: '100 mcg', form: 'Tablet', pack: 200, cls: 'Thyroid hormone', schedule: 'S4', pbs: '2173C', dpmq: 1990, maxQty: 200, maxRepeats: 5, minRepeatDays: 20, weight: 5, brands: [['Eutroxsig', 1320], ['Oroxine', 1400]] },
  { generic: 'Irbesartan', ingredient: 'irbesartan', strength: '150 mg', form: 'Tablet', pack: 30, cls: 'ARB', schedule: 'S4', pbs: '8242X', dpmq: 1410, maxQty: 30, maxRepeats: 5, minRepeatDays: 20, weight: 5, brands: [['Avapro', 1050], ['Irbesartan Sandoz', 380]] },
  { generic: 'Metoprolol', ingredient: 'metoprolol', strength: '50 mg', form: 'Tablet', pack: 100, cls: 'Beta blocker', schedule: 'S4', pbs: '1325Y', dpmq: 1260, maxQty: 100, maxRepeats: 5, minRepeatDays: 20, weight: 4, brands: [['Betaloc', 780], ['Minax', 720]] },
  { generic: 'Doxycycline', ingredient: 'doxycycline', strength: '100 mg', form: 'Tablet', pack: 7, cls: 'Tetracycline', schedule: 'S4', pbs: '2708J', dpmq: 1090, maxQty: 7, maxRepeats: 1, minRepeatDays: 0, weight: 3, brands: [['Doryx', 640], ['Doxsig', 380]] },
  { generic: 'Semaglutide', ingredient: 'semaglutide', strength: '1 mg/dose', form: 'Pen injector', pack: 1, cls: 'GLP-1 agonist', schedule: 'S4', pbs: '12345T', dpmq: 20950, maxQty: 1, maxRepeats: 5, minRepeatDays: 20, weight: 3, brands: [['Ozempic', 17800]] },
  { generic: 'Insulin glargine', ingredient: 'insulin glargine', strength: '100 units/mL', form: 'Pen injector', pack: 5, cls: 'Insulin', schedule: 'S4', pbs: '9304D', dpmq: 9820, maxQty: 5, maxRepeats: 5, minRepeatDays: 20, weight: 2, brands: [['Optisulin', 7900], ['Semglee', 7200]] },
  { generic: 'Trimethoprim', ingredient: 'trimethoprim', strength: '300 mg', form: 'Tablet', pack: 7, cls: 'Antibacterial', schedule: 'S4', pbs: '2744J', dpmq: 870, maxQty: 7, maxRepeats: 0, minRepeatDays: 0, weight: 3, brands: [['Alprim', 420], ['Triprim', 440]] },
];

export const INTERACTIONS: [string, string, 'HIGH' | 'MODERATE' | 'LOW', string][] = [
  ['warfarin', 'aspirin', 'HIGH', 'Concurrent use significantly increases bleeding risk. Avoid unless specifically directed; monitor INR closely and counsel on bleeding signs.'],
  ['warfarin', 'clopidogrel', 'HIGH', 'Additive antithrombotic effect with increased risk of major bleeding.'],
  ['apixaban', 'aspirin', 'MODERATE', 'Increased bleeding risk. Confirm dual therapy is intended by the prescriber.'],
  ['apixaban', 'clopidogrel', 'MODERATE', 'Increased bleeding risk with combined anticoagulant and antiplatelet therapy.'],
  ['sertraline', 'tramadol', 'HIGH', 'Risk of serotonin syndrome and lowered seizure threshold. Consider alternative analgesia.'],
  ['escitalopram', 'tramadol', 'HIGH', 'Risk of serotonin syndrome and lowered seizure threshold.'],
  ['oxycodone', 'codeine', 'HIGH', 'Additive CNS and respiratory depression from concurrent opioids.'],
  ['oxycodone', 'tramadol', 'HIGH', 'Additive CNS depression; tramadol also carries serotonergic and seizure risks.'],
  ['clopidogrel', 'esomeprazole', 'MODERATE', 'Esomeprazole may reduce the antiplatelet effect of clopidogrel via CYP2C19 inhibition. Pantoprazole is preferred.'],
  ['metformin', 'prednisolone', 'LOW', 'Corticosteroids may raise blood glucose. Monitor glycaemic control.'],
  ['warfarin', 'doxycycline', 'MODERATE', 'Doxycycline may potentiate the anticoagulant effect of warfarin. Monitor INR.'],
  ['warfarin', 'trimethoprim', 'MODERATE', 'Trimethoprim may increase INR. Monitor closely.'],
  ['perindopril', 'irbesartan', 'MODERATE', 'Dual RAAS blockade increases risk of hyperkalaemia, hypotension and renal impairment.'],
  ['levothyroxine', 'esomeprazole', 'LOW', 'Reduced gastric acidity may reduce levothyroxine absorption. Monitor TSH.'],
];

export interface RetailSeed {
  name: string;
  brand: string;
  category: string;
  cost: number;
  retail: number;
  hotkey?: string;
  gstFree?: boolean;
  weight: number;
}

export const RETAIL: RetailSeed[] = [
  { name: 'Panadol Tablets 500 mg 20', brand: 'Panadol', category: 'Pain Relief', cost: 210, retail: 499, hotkey: '#2563eb', gstFree: false, weight: 10 },
  { name: 'Panadol Osteo 665 mg 96', brand: 'Panadol', category: 'Pain Relief', cost: 980, retail: 1799, weight: 6 },
  { name: 'Nurofen Tablets 200 mg 24', brand: 'Nurofen', category: 'Pain Relief', cost: 420, retail: 849, hotkey: '#dc2626', weight: 9 },
  { name: 'Nurofen Zavance 200 mg 40', brand: 'Nurofen', category: 'Pain Relief', cost: 780, retail: 1499, weight: 5 },
  { name: 'Voltaren Emulgel 100 g', brand: 'Voltaren', category: 'Pain Relief', cost: 1150, retail: 2199, weight: 5 },
  { name: 'Codral Day & Night 24', brand: 'Codral', category: 'Cold & Flu', cost: 890, retail: 1699, weight: 5 },
  { name: 'Strepsils Honey & Lemon 36', brand: 'Strepsils', category: 'Cold & Flu', cost: 520, retail: 999, hotkey: '#f59e0b', weight: 7 },
  { name: 'Vicks VapoRub 100 g', brand: 'Vicks', category: 'Cold & Flu', cost: 640, retail: 1249, weight: 4 },
  { name: 'Betadine Sore Throat Gargle 120 mL', brand: 'Betadine', category: 'Cold & Flu', cost: 560, retail: 1099, weight: 4 },
  { name: 'Sudafed PE Sinus + Pain 24', brand: 'Sudafed', category: 'Cold & Flu', cost: 690, retail: 1349, weight: 4 },
  { name: 'Telfast 180 mg 30', brand: 'Telfast', category: 'Allergy', cost: 1180, retail: 2299, weight: 5 },
  { name: 'Claratyne 10 mg 30', brand: 'Claratyne', category: 'Allergy', cost: 1050, retail: 1999, weight: 5 },
  { name: 'Zyrtec 10 mg 30', brand: 'Zyrtec', category: 'Allergy', cost: 1090, retail: 2099, weight: 4 },
  { name: 'Beconase Allergy Nasal Spray 200 doses', brand: 'Beconase', category: 'Allergy', cost: 890, retail: 1699, weight: 3 },
  { name: 'Blackmores Vitamin C 1000 mg 60', brand: 'Blackmores', category: 'Vitamins & Supplements', cost: 880, retail: 1899, hotkey: '#16a34a', weight: 6 },
  { name: 'Blackmores Fish Oil 1000 mg 400', brand: 'Blackmores', category: 'Vitamins & Supplements', cost: 1650, retail: 3599, weight: 5 },
  { name: 'Swisse Women\'s Ultivite 120', brand: 'Swisse', category: 'Vitamins & Supplements', cost: 1980, retail: 4299, weight: 4 },
  { name: 'Swisse Men\'s Ultivite 120', brand: 'Swisse', category: 'Vitamins & Supplements', cost: 1980, retail: 4299, weight: 3 },
  { name: 'Ostelin Vitamin D3 1000 IU 250', brand: 'Ostelin', category: 'Vitamins & Supplements', cost: 1290, retail: 2799, weight: 4 },
  { name: 'Elevit Pregnancy Multivitamin 100', brand: 'Elevit', category: 'Vitamins & Supplements', cost: 3150, retail: 6499, weight: 3 },
  { name: 'Nature\'s Way Kids Smart Omega-3 50', brand: 'Nature\'s Way', category: 'Vitamins & Supplements', cost: 690, retail: 1499, weight: 3 },
  { name: 'Berocca Performance 30', brand: 'Berocca', category: 'Vitamins & Supplements', cost: 1050, retail: 2199, weight: 4 },
  { name: 'Cetaphil Gentle Skin Cleanser 500 mL', brand: 'Cetaphil', category: 'Skin Care', cost: 1180, retail: 2299, weight: 4 },
  { name: 'La Roche-Posay Anthelios SPF50+ 50 mL', brand: 'La Roche-Posay', category: 'Sun Care', cost: 1850, retail: 3499, weight: 3 },
  { name: 'Cancer Council SPF50+ Sunscreen 110 mL', brand: 'Cancer Council', category: 'Sun Care', cost: 690, retail: 1399, weight: 4 },
  { name: 'QV Skin Lotion 500 mL', brand: 'QV', category: 'Skin Care', cost: 920, retail: 1799, weight: 4 },
  { name: 'Sukin Hydrating Day Cream 120 mL', brand: 'Sukin', category: 'Skin Care', cost: 780, retail: 1649, weight: 3 },
  { name: 'Bepanthen Nappy Rash Ointment 100 g', brand: 'Bepanthen', category: 'Baby & Maternity', cost: 890, retail: 1699, weight: 3 },
  { name: 'Huggies Baby Wipes 80', brand: 'Huggies', category: 'Baby & Maternity', cost: 290, retail: 549, weight: 4 },
  { name: 'Aptamil Gold+ Toddler 900 g', brand: 'Aptamil', category: 'Baby & Maternity', cost: 1990, retail: 3099, gstFree: true, weight: 3 },
  { name: 'Band-Aid Tough Strips 20', brand: 'Band-Aid', category: 'First Aid', cost: 250, retail: 599, hotkey: '#0891b2', weight: 6 },
  { name: 'Dettol Antiseptic Liquid 250 mL', brand: 'Dettol', category: 'First Aid', cost: 480, retail: 949, weight: 3 },
  { name: 'Savlon Antiseptic Cream 30 g', brand: 'Savlon', category: 'First Aid', cost: 390, retail: 799, weight: 3 },
  { name: 'Elastoplast Crepe Bandage 7.5 cm', brand: 'Elastoplast', category: 'First Aid', cost: 290, retail: 649, weight: 2 },
  { name: 'Hand Sanitiser Gel 500 mL', brand: 'Segue Select', category: 'First Aid', cost: 290, retail: 799, hotkey: '#7c3aed', weight: 4 },
  { name: 'Surgical Face Masks 50', brand: 'Segue Select', category: 'First Aid', cost: 450, retail: 1199, hotkey: '#64748b', weight: 3 },
  { name: 'Gaviscon Dual Action Liquid 300 mL', brand: 'Gaviscon', category: 'Digestive Health', cost: 780, retail: 1549, weight: 4 },
  { name: 'Rennie Spearmint 36', brand: 'Rennie', category: 'Digestive Health', cost: 390, retail: 799, weight: 3 },
  { name: 'Metamucil Fibre 114 doses', brand: 'Metamucil', category: 'Digestive Health', cost: 1550, retail: 2999, weight: 3 },
  { name: 'Hydralyte Electrolyte Tablets 20', brand: 'Hydralyte', category: 'Digestive Health', cost: 520, retail: 1099, hotkey: '#0ea5e9', weight: 4 },
  { name: 'Imodium Zapid 12', brand: 'Imodium', category: 'Digestive Health', cost: 680, retail: 1349, weight: 2 },
  { name: 'Oral-B Pro 100 Toothbrush', brand: 'Oral-B', category: 'Oral Care', cost: 1650, retail: 2999, weight: 2 },
  { name: 'Sensodyne Repair & Protect 100 g', brand: 'Sensodyne', category: 'Oral Care', cost: 520, retail: 999, weight: 4 },
  { name: 'Listerine Total Care 500 mL', brand: 'Listerine', category: 'Oral Care', cost: 590, retail: 1149, weight: 3 },
  { name: 'Nicorette Quickmist 150 sprays', brand: 'Nicorette', category: 'Quit Smoking', cost: 2980, retail: 5499, weight: 2 },
  { name: 'Nicabate Clear Patch 21 mg 7', brand: 'Nicabate', category: 'Quit Smoking', cost: 2150, retail: 3999, weight: 2 },
  { name: 'Systane Ultra Eye Drops 10 mL', brand: 'Systane', category: 'Eye Care', cost: 890, retail: 1699, weight: 3 },
  { name: 'Optrex Eye Wash 110 mL', brand: 'Optrex', category: 'Eye Care', cost: 590, retail: 1149, weight: 2 },
  { name: 'Sorbolene Cream 500 g', brand: 'Segue Select', category: 'Skin Care', cost: 290, retail: 699, weight: 3 },
  { name: 'Deep Heat Rub 100 g', brand: 'Deep Heat', category: 'Pain Relief', cost: 590, retail: 1199, weight: 3 },
  { name: 'Coloxyl with Senna 90', brand: 'Coloxyl', category: 'Digestive Health', cost: 790, retail: 1549, weight: 2 },
  { name: 'Mylanta Original 500 mL', brand: 'Mylanta', category: 'Digestive Health', cost: 690, retail: 1349, weight: 2 },
  { name: 'Dermal Therapy Heel Balm 50 g', brand: 'Dermal Therapy', category: 'Skin Care', cost: 690, retail: 1399, weight: 2 },
  { name: 'Water 600 mL', brand: 'Segue Select', category: 'Grocery', cost: 60, retail: 300, hotkey: '#94a3b8', weight: 5 },
  { name: 'Glucose Tablets 50', brand: 'Segue Select', category: 'Grocery', cost: 180, retail: 450, weight: 2 },
];

export const FIRST_NAMES = ['Olivia', 'Jack', 'Charlotte', 'Oliver', 'Amelia', 'William', 'Isla', 'Noah', 'Mia', 'Thomas', 'Grace', 'Henry', 'Ava', 'Lucas', 'Chloe', 'James', 'Zoe', 'Leo', 'Ella', 'Harrison', 'Ruby', 'Ethan', 'Sophie', 'Max', 'Harper', 'Archie', 'Lily', 'Hugo', 'Evie', 'Riley', 'Anh', 'Minh', 'Aarav', 'Priya', 'Mei', 'Kai', 'Fatima', 'Omar', 'Nikos', 'Giulia'];
export const LAST_NAMES = ['Smith', 'Jones', 'Williams', 'Brown', 'Wilson', 'Taylor', 'Anderson', 'Martin', 'Thompson', 'White', 'Nguyen', 'Tran', 'Kelly', 'Walker', 'Harris', 'Ryan', 'Robinson', 'Singh', 'Patel', 'Chen', 'Wang', 'Papadopoulos', 'Rossi', 'Murphy', 'Campbell', 'Stewart', 'Hughes', 'Clarke', 'Mitchell', 'Evans'];

export const PRESCRIBERS: [name: string, number: string, type: string, practice: string][] = [
  ['Dr Helen Park', '2456781', 'GP', 'Harbour Medical Centre'],
  ['Dr Michael Rossi', '3198452', 'GP', 'Bondi Family Practice'],
  ['Dr Aisha Rahman', '2876345', 'GP', 'Parramatta Health Hub'],
  ['Dr Tom Fletcher', '4012387', 'SPECIALIST', 'Sydney Heart Clinic'],
  ['Dr Sarah O\'Connell', '3567812', 'GP', 'Newcastle Medical Group'],
  ['Dr Rajesh Iyer', '2934561', 'SPECIALIST', 'Illawarra Endocrinology'],
  ['Dr Emma Lawson', '3345987', 'GP', 'Blue Mountains Medical'],
  ['Jo Bennett NP', '5123498', 'NURSE_PRACTITIONER', 'Katoomba Community Health'],
  ['Dr Daniel Cho', '2789034', 'DENTIST', 'City Dental Studio'],
];
