import os
import json
import zipfile

def build():
    # Read package.json
    with open('package.json', 'r', encoding='utf-8') as f:
        pkg = json.load(f)

    name = pkg.get('name', 'thruster')
    version = pkg.get('version', '0.2.0')
    publisher = pkg.get('publisher', 'the-biKing')
    display_name = pkg.get('displayName', name)
    description = pkg.get('description', '')
    categories = ','.join(pkg.get('categories', []))

    vsixmanifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Id="{name}" Version="{version}" Language="en-US" Publisher="{publisher}" />
    <DisplayName>{display_name}</DisplayName>
    <Description xml:space="preserve">{description}</Description>
    <Tags>{categories}</Tags>
    <Categories>{categories}</Categories>
    <Icon>extension/Thruster.png</Icon>
    <License>extension/LICENSE</License>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.75.0" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace,web" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="https://github.com/the-biKing/Thruster.git" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Getstarted" Value="https://github.com/the-biKing/Thruster.git" />
      <Property Id="Microsoft.VisualStudio.Services.Links.GitHub" Value="https://github.com/the-biKing/Thruster.git" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Support" Value="https://github.com/the-biKing/Thruster/issues" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Learn" Value="https://github.com/the-biKing/Thruster#readme" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/Thruster.png" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>
'''

    content_types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="" ContentType="text/plain" />
</Types>
'''

    output_filename = f"{name}-{version}.vsix"

    # Remove any old vsix files with different versions
    import glob
    for old_file in glob.glob(f"{name}-*.vsix"):
        if old_file != output_filename:
            try:
                os.remove(old_file)
            except OSError:
                pass
    files_to_pack = [
        ('package.json', 'extension/package.json'),
        ('extension.js', 'extension/extension.js'),
        ('README.md', 'extension/README.md'),
        ('LICENSE', 'extension/LICENSE'),
        ('Thruster.png', 'extension/Thruster.png'),
    ]

    with zipfile.ZipFile(output_filename, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', content_types.strip())
        z.writestr('extension.vsixmanifest', vsixmanifest.strip())
        for src, arc in files_to_pack:
            if os.path.exists(src):
                z.write(src, arc)
                print(f"Added {src} -> {arc}")

    file_size = os.path.getsize(output_filename)
    print(f"Successfully generated {output_filename} ({file_size:,} bytes)")

if __name__ == '__main__':
    build()
