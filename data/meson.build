subdir('icons')

# FIXME: this is a workaround for libgd source location
libgd_src_path = join_paths(meson.source_root(), 'subprojects', 'libgd', 'libgd')

enum_headers = files(
  join_paths(libgd_src_path, 'gd-main-view.h'),
  join_paths(libgd_src_path, 'gd-main-view-generic.h')
)

gnome.mkenums(
  'org.gnome.Documents.enums.xml',
  sources: enum_headers,
  comments: '<!-- @comment@ -->',
  fhead: '<schemalist>',
  vhead: '  <@type@ id="org.gnome.Documents.@EnumName@">',
  vprod: '    <value nick="@valuenick@" value="@valuenum@"/>',
  vtail: '  </@type@>',
  ftail: '</schemalist>',
  install_header: true,
  install_dir: documents_schemadir
)

resource_data = files(
  'application.css',
  'media/dnd-counter.svg',
  'media/thumbnail-frame.png',
  'ui/app-menu.ui',
  'ui/app-menu.ui',
  'ui/help-overlay.ui',
  'ui/help-overlay.ui',
  'ui/organize-collection-dialog.ui',
  'ui/preview-context-menu.ui',
  'ui/preview-menu.ui',
  'ui/selection-menu.ui',
  'ui/selection-toolbar.ui',
  'ui/view-menu.ui'
)

resources = [
  'org.gnome.Books.data',
  'org.gnome.Documents.data'
]

foreach resource: resources
  sources += gnome.compile_resources(
    resource,
    resource + '.gresource.xml',
    source_dir: '.',
    dependencies: resource_data,
    gresource_bundle: true,
    install: true,
    install_dir: documents_pkgdatadir
  )
endforeach

appdatas = [
  'org.gnome.Books.appdata.xml',
  'org.gnome.Documents.appdata.xml'
]

foreach appdata: appdatas
  i18n.merge_file(
    appdata,
    input: appdata + '.in',
    output: appdata,
    po_dir: po_dir,
    install: true,
    install_dir: join_paths(documents_datadir, 'metainfo')
  )
endforeach

desktop_file_validate = find_program('desktop-file-validate')

desktops = [
  'org.gnome.Books.desktop',
  'org.gnome.Documents.desktop'
]

foreach desktop: desktops
  desktop_file = i18n.merge_file(
    desktop,
    type: 'desktop',
    input: desktop + '.in',
    output: desktop,
    po_dir: po_dir,
    install: true,
    install_dir: documents_desktopdir
  )
endforeach

install_data(
  'org.gnome.Documents.search-provider.ini',
  install_dir: join_paths(documents_datadir, 'gnome-shell', 'search-providers')
)

schemas = files(
  'org.gnome.books.gschema.xml',
  'org.gnome.documents.gschema.xml'
)

install_data(
  schemas,
  install_dir: documents_schemadir
)
