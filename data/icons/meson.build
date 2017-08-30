names = [
  'org.gnome.Books',
  'org.gnome.Documents'
]

icon_sizes = [
  '16x16',
  '22x22',
  '24x24',
  '32x32',
  '48x48',
  '256x256',
  '512x512'
]

foreach icon_size: icon_sizes
  foreach name: names
    install_data(
      '_'.join(['hicolor', 'apps', icon_size, name + '.png']),
      install_dir: join_paths(documents_icondir, 'hicolor', icon_size, 'apps')
    )
  endforeach
endforeach

foreach name: names
  install_data(
    '_'.join(['hicolor', 'apps', 'scalable', name + '-symbolic.svg']),
    install_dir: join_paths(documents_icondir, 'hicolor', 'scalable', 'apps')
  )
endforeach
