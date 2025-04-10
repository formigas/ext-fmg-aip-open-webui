import { env } from '$env/dynamic/public';
import fs from 'node:fs';
import path from 'node:path';

interface CustomThemesConfig {
  [key: string]: string; 
}

export function loadCustomThemesFromEnv(): CustomThemesConfig | null {
  const themesFilePath = env.PUBLIC_CUSTOM_THEMES_PATH;

  if (!themesFilePath) {
    console.info('PUBLIC_CUSTOM_THEMES_PATH environment variable is not set.');
    return null;
  }

  const absolutePath = path.resolve(process.cwd(), themesFilePath);
  console.log(`Attempting to load themes from: ${absolutePath}`);

  try {
    if (!fs.existsSync(absolutePath)) {
        console.error(`Error: Themes file not found at path: ${absolutePath}`);
        return null;
    }

    const fileContentString = fs.readFileSync(absolutePath, 'utf-8');
    const parsedJson: CustomThemesConfig = JSON.parse(fileContentString);

    console.log('Successfully loaded and parsed custom themes.');
    return parsedJson;

  } catch (error) {
    console.error(`Error reading or parsing themes file at ${absolutePath}:`, error);
    return null;
  }
} 