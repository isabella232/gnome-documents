NULL =

public_icons_themes = \
	hicolor	\
	$(NULL)

public_scalable_iconsdir = $(datadir)/icons/hicolor/scalable/apps
public_scalable_icons_DATA = \
	hicolor/scalable/apps/org.gnome.Books-symbolic.svg \
	hicolor/scalable/apps/org.gnome.Documents-symbolic.svg

public_16x16_iconsdir = $(datadir)/icons/hicolor/16x16/apps
public_16x16_icons_DATA = \
	hicolor/16x16/apps/org.gnome.Books.png \
	hicolor/16x16/apps/org.gnome.Documents.png

public_22x22_iconsdir = $(datadir)/icons/hicolor/22x22/apps
public_22x22_icons_DATA = \
	hicolor/22x22/apps/org.gnome.Books.png \
	hicolor/22x22/apps/org.gnome.Documents.png

public_24x24_iconsdir = $(datadir)/icons/hicolor/24x24/apps
public_24x24_icons_DATA = \
	hicolor/24x24/apps/org.gnome.Books.png \
	hicolor/24x24/apps/org.gnome.Documents.png

public_32x32_iconsdir = $(datadir)/icons/hicolor/32x32/apps
public_32x32_icons_DATA = \
	hicolor/32x32/apps/org.gnome.Books.png \
	hicolor/32x32/apps/org.gnome.Documents.png

public_48x48_iconsdir = $(datadir)/icons/hicolor/48x48/apps
public_48x48_icons_DATA = \
	hicolor/48x48/apps/org.gnome.Books.png \
	hicolor/48x48/apps/org.gnome.Documents.png

public_256x256_iconsdir = $(datadir)/icons/hicolor/256x256/apps
public_256x256_icons_DATA = \
	hicolor/256x256/apps/org.gnome.Books.png \
	hicolor/256x256/apps/org.gnome.Documents.png

public_512x512_iconsdir = $(datadir)/icons/hicolor/512x512/apps
public_512x512_icons_DATA = \
	hicolor/512x512/apps/org.gnome.Books.png \
	hicolor/512x512/apps/org.gnome.Documents.png

noinst_DATA = \
	hicolor_org.gnome.Books.blend \
	hicolor_org.gnome.Books.svg \
	hicolor_org.gnome.Documents.svg \
	$(NULL)

EXTRA_DIST = \
	$(public_scalable_icons_DATA)	\
	$(public_16x16_icons_DATA)	\
	$(public_22x22_icons_DATA)	\
	$(public_24x24_icons_DATA)	\
	$(public_48x48_icons_DATA)	\
	$(public_256x256_icons_DATA)	\
	$(public_512x512_icons_DATA)	\
	$(noinst_DATA)			\
	meson.build			\
	$(NULL)

###############################################################################

gtk_update_icon_cache = gtk-update-icon-cache -f -t

update-icon-cache:
	@-if test -z "$(DESTDIR)"; then \
		echo "Updating Gtk icon cache."; \
		for theme in $(public_icons_themes); do \
			$(gtk_update_icon_cache) $(datadir)/icons/$$theme; \
		done; \
	else \
		echo "*** Icon cache not updated.  After (un)install, run this:"; \
		for theme in $(public_icons_themes); do \
			echo "***   $(gtk_update_icon_cache) $(datadir)/icons/$$theme"; \
		done; \
	fi

install-data-hook: update-icon-cache

uninstall-hook: update-icon-cache

-include $(top_srcdir)/git.mk
