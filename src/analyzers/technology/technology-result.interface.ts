export type TechnologyCategory =
  | 'framework'
  | 'cms'
  | 'infrastructure'
  | 'analytics'
  | 'payments'
  | 'css-framework'
  | 'font'
  | 'library';

export interface DetectedTechnology {
  name: string;
  category: TechnologyCategory;
  confidence: number;
  evidence: string[];
}

export interface AdditionalLibrary {
  name: string;
  version?: string;
  detectedIn: 'inline' | 'external';
}

export interface TechnologyResult {
  technologies: DetectedTechnology[];
  additionalLibraries?: AdditionalLibrary[];
}
