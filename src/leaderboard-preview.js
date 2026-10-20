// Fictional preview rows only. The live leaderboard will replace this source in a later PR.
export const SAMPLE_RANKINGS = Object.freeze([
  ['SKY',14.82],['VEX',13.57],['JET',12.93],['SOL',12.38],['RAY',11.76],
  ['NVA',11.19],['AX7',10.64],['MIA',10.08],['ZEN',9.72],['ACE',9.24],
  ['FOX',8.89],['LUX',8.42],['RIO',8.03],['KID',7.66],['ORA',7.21],
  ['HAL',6.85],['PIX',6.48],['EKO',6.07],['SUN',5.71],['TWO',5.34],
  ['DRM',4.92],['BEE',4.51],['MAX',4.12],['B4U',3.68],['ZED',3.23],
]);

export function previewRankings(limit=20){
  return SAMPLE_RANKINGS.slice(0,limit).map(([initials,km],index)=>({rank:index+1,initials,km}));
}
