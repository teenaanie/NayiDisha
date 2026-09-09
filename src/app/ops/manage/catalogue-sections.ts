export const catalogueSections = [
 {key:'localities',title:'Localities',description:'Add a service area and its map coordinates.'},
 {key:'roles',title:'Industries & roles',description:'Add an industry or sourcing capability.'},
 {key:'matching',title:'Experience matching',description:'Edit direct experience and transferable skills.'},
 {key:'fields',title:'Candidate & job fields',description:'Define a field for role configurations.'},
 {key:'configurations',title:'Role configurations',description:'Edit draft requirements, assessments and scoring.'},
 {key:'commercial',title:'Commercial defaults',description:'Edit rewards, payout minimum and matching defaults.'},
] as const;
export type CatalogueSection = typeof catalogueSections[number]['key'];
