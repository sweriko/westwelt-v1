/**
 * Control panel for the FPS full-body camera settings
 */
import { FPSBodySettings } from './fpsBodySystem';
import { PlayerSystemConfig } from './index';

// Settings categories
interface SettingsCategory {
  title: string;
  settings: Setting[];
  expanded: boolean;
}

// Individual setting
interface Setting {
  name: string;
  type: 'slider' | 'checkbox' | 'vector3';
  min?: number;
  max?: number;
  get: () => any;
  set: (val: any) => void;
  step?: number;
  description?: string;
}

export function createControlPanel() {
  // If control panel is disabled, do nothing
  if (!PlayerSystemConfig.SHOW_CONTROL_PANEL) {
    return;
  }
  
  // Check if panel already exists
  if (document.getElementById('fpsControlPanel')) {
    return;
  }
  
  // Create categories of settings
  const categories: SettingsCategory[] = [
    {
      title: 'Camera Positioning',
      expanded: true,
      settings: [
        {
          name: 'Camera Offset X',
          type: 'slider',
          min: -50,
          max: 50,
          step: 1,
          get: () => FPSBodySettings.CAMERA_OFFSET.x,
          set: (val) => FPSBodySettings.CAMERA_OFFSET.x = val,
          description: 'Left/right camera offset from eye position'
        },
        {
          name: 'Camera Offset Y',
          type: 'slider',
          min: -50,
          max: 50,
          step: 1,
          get: () => FPSBodySettings.CAMERA_OFFSET.y,
          set: (val) => FPSBodySettings.CAMERA_OFFSET.y = val,
          description: 'Up/down camera offset from eye position'
        },
        {
          name: 'Camera Offset Z',
          type: 'slider',
          min: -50,
          max: 50,
          step: 1,
          get: () => FPSBodySettings.CAMERA_OFFSET.z,
          set: (val) => FPSBodySettings.CAMERA_OFFSET.z = val,
          description: 'Forward/backward camera offset from eye position'
        }
      ]
    },
    {
      title: 'Debug',
      expanded: true,
      settings: [
        {
          name: 'Debug Visualization',
          type: 'checkbox',
          get: () => FPSBodySettings.DEBUG_VISUALIZATION,
          set: (val) => FPSBodySettings.DEBUG_VISUALIZATION = val,
          description: 'Show helpers for skeleton, bones, etc.'
        }
      ]
    }
  ];
  
  // Create panel container
  const panel = document.createElement('div');
  panel.id = 'fpsControlPanel';
  panel.style.position = 'fixed';
  panel.style.top = '10px';
  panel.style.right = '10px';
  panel.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  panel.style.color = 'white';
  panel.style.padding = '10px';
  panel.style.borderRadius = '5px';
  panel.style.zIndex = '1000';
  panel.style.width = '300px';
  panel.style.fontFamily = 'Arial, sans-serif';
  panel.style.maxHeight = '80vh';
  panel.style.overflowY = 'auto';
  
  // Header
  const header = document.createElement('div');
  header.textContent = 'FPS Camera Settings';
  header.style.fontWeight = 'bold';
  header.style.marginBottom = '10px';
  header.style.borderBottom = '1px solid #555';
  header.style.paddingBottom = '5px';
  panel.appendChild(header);
  
  // Toggle button to show/hide panel
  const toggleButton = document.createElement('button');
  toggleButton.textContent = 'Hide';
  toggleButton.style.position = 'absolute';
  toggleButton.style.top = '10px';
  toggleButton.style.right = '10px';
  toggleButton.style.backgroundColor = '#555';
  toggleButton.style.border = 'none';
  toggleButton.style.color = 'white';
  toggleButton.style.padding = '2px 5px';
  toggleButton.style.borderRadius = '3px';
  toggleButton.style.cursor = 'pointer';
  panel.appendChild(toggleButton);
  
  // Content container
  const content = document.createElement('div');
  content.id = 'fpsControlPanelContent';
  panel.appendChild(content);
  
  // Toggle panel visibility
  let isPanelVisible = true;
  toggleButton.addEventListener('click', () => {
    isPanelVisible = !isPanelVisible;
    content.style.display = isPanelVisible ? 'block' : 'none';
    toggleButton.textContent = isPanelVisible ? 'Hide' : 'Show';
  });
  
  // Create sections for each category
  categories.forEach(category => {
    const section = document.createElement('div');
    section.style.marginBottom = '15px';
    
    // Category header
    const categoryHeader = document.createElement('div');
    categoryHeader.textContent = category.title;
    categoryHeader.style.fontWeight = 'bold';
    categoryHeader.style.marginBottom = '5px';
    categoryHeader.style.cursor = 'pointer';
    categoryHeader.style.backgroundColor = 'rgba(80, 80, 80, 0.5)';
    categoryHeader.style.padding = '3px 5px';
    categoryHeader.style.borderRadius = '3px';
    section.appendChild(categoryHeader);
    
    // Category content
    const categoryContent = document.createElement('div');
    categoryContent.style.display = category.expanded ? 'block' : 'none';
    categoryContent.style.paddingLeft = '10px';
    section.appendChild(categoryContent);
    
    // Toggle category expansion
    categoryHeader.addEventListener('click', () => {
      category.expanded = !category.expanded;
      categoryContent.style.display = category.expanded ? 'block' : 'none';
    });
    
    // Add each setting
    category.settings.forEach(setting => {
      const settingContainer = document.createElement('div');
      settingContainer.style.marginBottom = '8px';
      
      // Setting label
      const label = document.createElement('div');
      label.textContent = setting.name;
      label.style.marginBottom = '2px';
      settingContainer.appendChild(label);
      
      // Setting tooltip (description)
      if (setting.description) {
        label.title = setting.description;
        label.style.cursor = 'help';
      }
      
      if (setting.type === 'slider') {
        // Create slider container
        const sliderContainer = document.createElement('div');
        sliderContainer.style.display = 'flex';
        sliderContainer.style.alignItems = 'center';
        
        // Slider input
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = setting.min!.toString();
        slider.max = setting.max!.toString();
        slider.step = setting.step?.toString() || '0.01';
        slider.value = setting.get().toString();
        slider.style.flex = '1';
        
        // Value display
        const valueDisplay = document.createElement('span');
        valueDisplay.textContent = Number(slider.value).toFixed(2);
        valueDisplay.style.marginLeft = '10px';
        valueDisplay.style.width = '40px';
        valueDisplay.style.textAlign = 'right';
        
        // Update on input
        slider.addEventListener('input', () => {
          const value = parseFloat(slider.value);
          valueDisplay.textContent = value.toFixed(2);
          setting.set(value);
        });
        
        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(valueDisplay);
        settingContainer.appendChild(sliderContainer);
      } else if (setting.type === 'checkbox') {
        // Create checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = setting.get();
        checkbox.id = `setting_${setting.name.replace(/\s+/g, '_')}`;
        
        // Create label
        const checkLabel = document.createElement('label');
        checkLabel.htmlFor = checkbox.id;
        checkLabel.textContent = `Enable ${setting.name}`;
        checkLabel.style.marginLeft = '5px';
        
        // Update on change
        checkbox.addEventListener('change', () => {
          setting.set(checkbox.checked);
        });
        
        // Add to container
        const checkboxContainer = document.createElement('div');
        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(checkLabel);
        settingContainer.appendChild(checkboxContainer);
      } else if (setting.type === 'vector3') {
        // Not implemented in this basic control panel
        const notImplemented = document.createElement('div');
        notImplemented.textContent = 'Vector3 controls not implemented';
        notImplemented.style.color = '#aaa';
        notImplemented.style.fontStyle = 'italic';
        notImplemented.style.fontSize = '0.8em';
        settingContainer.appendChild(notImplemented);
      }
      
      categoryContent.appendChild(settingContainer);
    });
    
    content.appendChild(section);
  });
  
  // Reset button
  const resetButton = document.createElement('button');
  resetButton.textContent = 'Reset to Defaults';
  resetButton.style.backgroundColor = '#555';
  resetButton.style.border = 'none';
  resetButton.style.color = 'white';
  resetButton.style.padding = '5px 10px';
  resetButton.style.borderRadius = '3px';
  resetButton.style.cursor = 'pointer';
  resetButton.style.width = '100%';
  resetButton.style.marginTop = '10px';
  
  resetButton.addEventListener('click', () => {
    // Reset settings to defaults
    FPSBodySettings.CAMERA_OFFSET.set(0, 16, 33);
    FPSBodySettings.DEBUG_VISUALIZATION = false;
    
    // Update UI elements with new values
    document.querySelectorAll('#fpsControlPanelContent input').forEach(input => {
      if (input instanceof HTMLInputElement) {
        const containerDiv = input.closest('div')?.parentElement;
        if (!containerDiv) return;
        
        // Find the setting this input corresponds to
        let foundSetting: Setting | undefined;
        for (const category of categories) {
          foundSetting = category.settings.find(s => 
            containerDiv.querySelector('div')?.textContent === s.name
          );
          if (foundSetting) break;
        }
        
        if (foundSetting) {
          if (input.type === 'range') {
            input.value = foundSetting.get().toString();
            const valueDisplay = input.nextElementSibling as HTMLElement;
            if (valueDisplay) {
              valueDisplay.textContent = Number(input.value).toFixed(2);
            }
          } else if (input.type === 'checkbox') {
            input.checked = foundSetting.get();
          }
        }
      }
    });
    
    // Force settings update event
    const refreshEvent = new CustomEvent('fps-settings-changed', { 
      detail: { settings: FPSBodySettings } 
    });
    document.dispatchEvent(refreshEvent);
    
    console.log('FPS Camera settings reset to defaults');
  });
  
  content.appendChild(resetButton);
  
  // Apply button to force refresh settings
  const applyButton = document.createElement('button');
  applyButton.textContent = 'Apply Changes';
  applyButton.style.backgroundColor = '#3a7d34';
  applyButton.style.border = 'none';
  applyButton.style.color = 'white';
  applyButton.style.padding = '5px 10px';
  applyButton.style.borderRadius = '3px';
  applyButton.style.cursor = 'pointer';
  applyButton.style.width = '100%';
  applyButton.style.marginTop = '10px';
  applyButton.style.marginBottom = '5px';
  
  applyButton.addEventListener('click', () => {
    // Force refresh by triggering events
    const refreshEvent = new CustomEvent('fps-settings-changed', { 
      detail: { settings: FPSBodySettings } 
    });
    document.dispatchEvent(refreshEvent);
    console.log('Applied FPS Camera settings');
  });
  
  content.appendChild(applyButton);
  
  // Add panel to document body
  document.body.appendChild(panel);
  
  // Setup event listener for settings changes
  document.addEventListener('fps-settings-changed', () => {
    // This will be used by other systems to react to setting changes
    console.log('FPS settings changed event triggered');
  });
  
  return panel;
} 