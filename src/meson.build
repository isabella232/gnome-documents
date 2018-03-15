# FIXME: are config.js and path.js (missing) not needed anymore?
'''
js_conf = configuration_data()
js_conf.set('PACKAGE_NAME', meson.project_name())
js_conf.set('PACKAGE_VERSION', documents_version)
js_conf.set('GETTEXT_PACKAGE', meson.project_name())

js = 'config.js'

configure_file(
  input: js + '.in',
  output: js,
  configuration: js_conf
)
'''

headers = files(
  'lib/gd-bookmark.h',
  'lib/gd-bookmarks.h',
  'lib/gd-display-preview.h',
  'lib/gd-metadata.h',
  'lib/gd-nav-bar.h',
  'lib/gd-pdf-loader.h',
  'lib/gd-places-bookmarks.h',
  'lib/gd-places-links.h',
  'lib/gd-places-page.h',
  'lib/gd-utils.h'
)

sources = files(
  'lib/gd-bookmark.c',
  'lib/gd-bookmarks.c',
  'lib/gd-display-preview.c',
  'lib/gd-metadata.c',
  'lib/gd-nav-bar.c',
  'lib/gd-pdf-loader.c',
  'lib/gd-places-bookmarks.c',
  'lib/gd-places-links.c',
  'lib/gd-places-page.c',
  'lib/gd-utils.c',
)

resource_data = files(
  'application.js',
  'changeMonitor.js',
  'documents.js',
  'edit.js',
  'embed.js',
  'epubview.js',
  'errorBox.js',
  'evinceview.js',
  'fullscreenAction.js',
  'lokview.js',
  'main.js',
  'mainToolbar.js',
  'mainWindow.js',
  'manager.js',
  'miners.js',
  'notifications.js',
  'overview.js',
  'password.js',
  'places.js',
  'presentation.js',
  'preview.js',
  'properties.js',
  'query.js',
  'searchbar.js',
  'search.js',
  'selections.js',
  'sharing.js',
  'shellSearchProvider.js',
  'testentry.js',
  'trackerController.js',
  'trackerUtils.js',
  'utils.js',
  'windowMode.js'
)

service_conf = configuration_data()
service_conf.set('bindir', documents_bindir)

app_conf = configuration_data()
app_conf.set('prefix', documents_prefix)
app_conf.set('libdir', documents_libdir)
app_conf.set('PACKAGE_VERSION', documents_version)
app_conf.set('GJS', gjs_console)

foreach app: documents_apps
  service = app + '.service'

  configure_file(
    input: service + '.in',
    output: service,
    install: true,
    install_dir: join_paths(documents_datadir, 'dbus-1', 'services'),
    configuration: service_conf
  )

  configure_file(
    input: app + '.in',
    output: app,
    install: true,
    install_dir: documents_pkgdatadir,
    configuration: app_conf
  )

  resource = app + '.src'

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

incs = [
  top_inc,
  include_directories('lib')
]

cflags = [
  '-DPREFIX="@0@"'.format(documents_prefix),
  '-DLIBDIR="@0@"'.format(documents_libdir),
  '-DG_LOG_DOMAIN="Gdprivate"',
  '-DG_DISABLE_DEPRECATED'
]

libgdprivate = shared_library(
  '@0@-@1@'.format(documents_private_ns.to_lower(), documents_api_version),
  sources: sources,
  include_directories: incs,
  dependencies: documents_deps,
  c_args: cflags,
  install: true,
  install_dir: documents_pkglibdir
)

gir_incs = [
  'GData-0.0',
  'GnomeDesktop-3.0',
  'Goa-1.0',
  'Gtk-3.0',
  'EvinceDocument-3.0',
  'EvinceView-3.0',
  'Zpj-0.0'
]

gnome.generate_gir(
  libgdprivate,
  sources: sources + headers,
  nsversion: documents_api_version,
  namespace: documents_private_ns,
  identifier_prefix: documents_ns,
  symbol_prefix: documents_ns.to_lower(),
  includes: gir_incs,
  install: true,
  install_dir_gir: join_paths(documents_pkgdatadir, 'gir-' + documents_gir_version),
  install_dir_typelib: join_paths(documents_pkglibdir, 'girepository-' + documents_gir_version)
)
