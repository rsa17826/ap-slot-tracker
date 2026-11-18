{
  inputs = {
    nixpkgs = {
      url = "github:NixOS/nixpkgs/26.05";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      pkgs = import nixpkgs {
        system = "x86_64-linux";
        overlays = [
          (final: prev: {
            python3 = prev.python313;
            python3Packages = prev.python313Packages;
          })
        ];
      };
      pylib = with pkgs.python3Packages; [
        pyyaml
        pathspec
        typing-extensions
        schema
        bsdiff4

        pygobject3

        orjson
        requests
        jinja2
        colorama
        websockets
        (pkgs.python313Packages.buildPythonPackage rec {
          pname = "pyevermizer";
          version = "0.50.1";
          pyproject = true;

          src = pkgs.fetchPypi {
            inherit pname version;
            hash = "sha256-zVbMom7ZZ1eQFU3XBAKtKKOB/DyQMb0C65sdrYwxc5g=";
          };
          build-system = [
            pkgs.python313Packages.hatchling
            pkgs.python313Packages.setuptools
          ];
          doCheck = false;
        })
      ];
      pythonEnv = pkgs.python3.withPackages (_: pylib);
    in
    {
      devShells = {
        x86_64-linux = {
          default = pkgs.mkShell {
            buildInputs =
              with pkgs;
              [
                gtk3
                gobject-introspection
                gsettings-desktop-schemas
                glib-networking
              ]
              ++ pylib;
            shellHook = ''
              export XDG_DATA_DIRS=${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS
              export GIO_EXTRA_MODULES=${pkgs.glib-networking}/lib/gio/modules
            '';
          };
        };
      };

      packages = {
        x86_64-linux = {
          default = pkgs.stdenv.mkDerivation {
            pname = "ap-slot-tracker";
            version = "1";
            src = ./.;
            nativeBuildInputs = with pkgs; [
              makeWrapper
              wrapGAppsHook3
              gobject-introspection
            ];
            buildInputs = with pkgs; [
              gtk3
              gsettings-desktop-schemas
              glib-networking
            ];
            dontBuild = true;
            dontWrapGApps = true; # wrapped by hand below so we get one wrapper, not two
            installPhase = ''
              mkdir -p $out/share/ap-slot-tracker
              cp -r . $out/share/ap-slot-tracker
            '';
            postFixup = ''
              makeWrapper ${pythonEnv}/bin/python $out/bin/ap-slot-tracker \
                --add-flags $out/share/ap-slot-tracker/app.py \
                --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.libnotify ]} \
                "''${gappsWrapperArgs[@]}"
            '';
            meta = {
              mainProgram = "ap-slot-tracker";
            };
          };
        };
      };
    };
}
