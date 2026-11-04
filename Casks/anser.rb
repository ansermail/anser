cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.38"
  sha256 arm:   "65838213012b8091392115673a85f629d0b1f18a31d7d5256ed40461b3c4f5ed",
         intel: "727d24b75388748f634a61699b3279825769013b68208325ff82babf1556a53f"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
