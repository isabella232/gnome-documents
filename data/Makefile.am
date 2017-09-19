SUBDIRS = icons

appdir = $(pkgdatadir)

app_resource_files =							\
	$(shell $(GLIB_COMPILE_RESOURCES)				\
		--sourcedir=$(srcdir)					\
		--generate-dependencies					\
		$(srcdir)/org.gnome.Documents.data.gresource.xml	\
	)
org.gnome.Documents.data.gresource: org.gnome.Documents.data.gresource.xml $(app_resource_files)
	$(AM_V_GEN) $(GLIB_COMPILE_RESOURCES)				\
		--target=$@						\
		--sourcedir=$(srcdir) $<

org.gnome.Books.data.gresource: org.gnome.Books.data.gresource.xml $(app_resource_files)
	$(AM_V_GEN) $(GLIB_COMPILE_RESOURCES)				\
		--target=$@						\
		--sourcedir=$(srcdir) $<

resourcedir = $(pkgdatadir)
resource_DATA = org.gnome.Documents.data.gresource org.gnome.Books.data.gresource

metainfodir = $(datadir)/metainfo
metainfo_DATA = $(metainfo_in_files:.xml.in=.xml)
metainfo_in_files = \
	org.gnome.Documents.metainfo.xml.in \
	org.gnome.Books.metainfo.xml.in

org.gnome.Books.metainfo.xml: org.gnome.Books.metainfo.xml.in
	$(AM_V_GEN)$(MSGFMT) --xml --template $< -d $(top_srcdir)/po -o $@

org.gnome.Documents.metainfo.xml: org.gnome.Documents.metainfo.xml.in
	$(AM_V_GEN)$(MSGFMT) --xml --template $< -d $(top_srcdir)/po -o $@

desktopdir = $(datadir)/applications
desktop_DATA = $(desktop_in_files:.desktop.in=.desktop)
desktop_in_files = org.gnome.Documents.desktop.in org.gnome.Books.desktop.in

org.gnome.Books.desktop: org.gnome.Books.desktop.in
	$(AM_V_GEN)$(MSGFMT) --desktop --template $< -d $(top_srcdir)/po -o $@

org.gnome.Documents.desktop: org.gnome.Documents.desktop.in
	$(AM_V_GEN)$(MSGFMT) --desktop --template $< -d $(top_srcdir)/po -o $@

searchproviderdir = $(datadir)/gnome-shell/search-providers
searchprovider_DATA = org.gnome.Documents.search-provider.ini

check-local: org.gnome.Documents.desktop org.gnome.Books.desktop
	$(DESKTOP_FILE_VALIDATE) org.gnome.Documents.desktop
	$(DESKTOP_FILE_VALIDATE) org.gnome.Books.desktop

gsettings_ENUM_NAMESPACE = org.gnome.Documents
gsettings_ENUM_FILES = \
    $(top_srcdir)/subprojects/libgd/libgd/gd-main-view.h \
    $(top_srcdir)/subprojects/libgd/libgd/gd-main-view-generic.h

gsettings_SCHEMAS = org.gnome.documents.gschema.xml org.gnome.books.gschema.xml
.PRECIOUS: $(gsettings_SCHEMAS)

@GSETTINGS_RULES@

EXTRA_DIST= \
    $(metainfo_in_files) \
    $(app_resource_files) \
    $(desktop_in_files) \
    $(searchprovider_DATA) \
    $(gsettings_SCHEMAS) \
    org.gnome.Documents.data.gresource.xml \
    org.gnome.Books.data.gresource.xml

CLEANFILES = \
    org.gnome.Documents.data.gresource \
    org.gnome.Books.data.gresource \
    $(metainfo_DATA) \
    $(desktop_DATA)

-include $(top_srcdir)/git.mk
