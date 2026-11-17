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
        pywebview
        schema
        bsdiff4

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
    in
    {
      devShells = {
        x86_64-linux = {
          default = pkgs.mkShell {
            buildInputs = pylib;
          };
        };
      };

      packages = {
        x86_64-linux = {
          default = pkgs.writers.writePython3Bin "generate-global-tracker-data" {
            doCheck = false;
            libraries = pylib;
          } ./generate-global-tracker-data.py;
        };
      };
    };
}
